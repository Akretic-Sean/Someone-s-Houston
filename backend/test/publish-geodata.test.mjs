import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createGeoPublisher, featureBatches, sourceVersion } from '../dist/publish-geodata.js';

const point = (id, padding = '') => ({ type: 'Feature', id, properties: { source_id: 'test_places', name: `Place ${id}`, padding }, geometry: { type: 'Point', coordinates: [-95.4, 29.7] } });
const source = count => ({ source_id: 'test_places', category: 'parks', source_count: count, source_url: 'https://city.example/data', source_checked_at: '2026-09-19T00:00:00Z', source_published_at: null, source_period: null, attribution: 'Test source', note: 'Test fixture' });
const snapshot = count => ({ sources: [source(count)], features: Array.from({ length: count }, (_, i) => point(i + 1)) });
const response = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const options = { url: 'https://example.supabase.co', secretKey: 'sb_secret_test' };
const boundaryVersion = 'coh-sn-boundaries-1234567890abcdef';
const boundaries = () => ({ features: Array.from({ length: 88 }, (_, i) => ({ type: 'Feature', id: i + 1, properties: { neighborhood_id: i + 1, name: `Neighborhood ${i + 1}`, boundary_version: boundaryVersion }, geometry: { type: 'Polygon', coordinates: [[[-95.5, 29.7], [-95.4, 29.7], [-95.4, 29.8], [-95.5, 29.7]]] } })) });

test('chunks by row count and UTF-8 byte size without reordering or losing features', () => {
  const rows = Array.from({ length: 251 }, (_, i) => point(i + 1));
  const batches = featureBatches(rows, 1_900_000, 100);
  assert.deepEqual(batches.map(batch => batch.length), [100, 100, 51]);
  assert.deepEqual(batches.flat(), rows);
  const unicode = [point(1, 'é'.repeat(200)), point(2, 'é'.repeat(200))];
  assert.ok(JSON.stringify(unicode).length < 1000);
  assert.ok(Buffer.byteLength(JSON.stringify(unicode)) > 1000);
  assert.deepEqual(featureBatches(unicode, 1000).map(batch => batch.length), [1, 1]);
  const exact = Buffer.byteLength(JSON.stringify(unicode));
  assert.deepEqual(featureBatches(unicode, exact).map(batch => batch.length), [2]);
  assert.deepEqual(featureBatches([], 1000), []);
});

test('large individual polygons use singleton batches under a hard cap; invalid limits reject', () => {
  const features = [point(1), point(2, 'x'.repeat(2000)), point(3)];
  const batches = featureBatches(features, 1000);
  assert.deepEqual(batches.map(batch => batch.length), [1, 1, 1]);
  assert.ok(batches.every(batch => Buffer.byteLength(JSON.stringify(batch)) <= 1_900_000));
  assert.throws(() => featureBatches([point(1, 'x'.repeat(1_900_000))]), /size limit/);
  for (const bytes of [NaN, Infinity, 999, 1000.5, 1_900_001]) assert.throws(() => featureBatches(features, bytes), /limits/);
  for (const rows of [0, 101, NaN, Infinity, 1.5]) assert.throws(() => featureBatches(features, 1000, rows), /limits/);
});

test('rejects malformed IDs/properties/geometries and IDs colliding after string conversion', () => {
  const invalid = [null, {}, { ...point(1), type: 'Point' }, { ...point(1), properties: null }, { ...point(1), properties: [] }, { ...point(1), geometry: null }];
  for (const id of [null, undefined, true, '', ' ', 'x'.repeat(201), NaN, Infinity, 1.5]) invalid.push({ ...point(1), id });
  for (const geometry of [{ type: 'Point', coordinates: [NaN, 29] }, { type: 'Point', coordinates: [-95, 190] }, { type: 'Point', coordinates: [-95] }, { type: 'LineString', coordinates: [[-95, 29], [-94, 30]] }, { type: 'Polygon', coordinates: [] }, { type: 'Polygon', coordinates: [[[-95, 29], [-94, 29], [-94, 30], [-95, 30]]] }]) invalid.push({ ...point(1), geometry });
  for (const feature of invalid) assert.throws(() => featureBatches([point(100), feature]));
  assert.throws(() => featureBatches([point(1), point('1')]), /Duplicate/);
});

test('requires a modern nonempty secret key and a project base URL before any network request', () => {
  let calls = 0;
  const fetcher = async () => { calls++; return response({}); };
  for (const secretKey of ['', 'sb_publishable_test', 'eyJold-service-role', 'sb_secret_', 'sb_secret_test\n', 'sb_secret_has space']) assert.throws(() => createGeoPublisher({ ...options, secretKey, fetch: fetcher }), /sb_secret_/);
  for (const url of ['http://example.supabase.co', 'https://user:password@example.supabase.co', 'https://example.supabase.co/rest/v1', 'https://example.supabase.co?x=1', 'https://example.supabase.co#x']) assert.throws(() => createGeoPublisher({ ...options, url, fetch: fetcher }));
  assert.equal(calls, 0);
});

test('staging is sequential and fails closed without publishing or starting later sources', async () => {
  const calls = [];
  const publisher = createGeoPublisher({ ...options, fetch: async (url, init) => {
    calls.push({ path: new URL(url).pathname, body: JSON.parse(init.body) });
    return calls.length === 2 ? new Response('unavailable', { status: 503 }) : response({ staged: true });
  } });
  await assert.rejects(publisher.amenities(snapshot(201)), /503/);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.path === '/rest/v1/rpc/stage_geo_import'));
  assert.deepEqual(calls.map(call => call.body.p_features.length), [100, 100]);
});

test('validates complete releases before staging and only publishes after all batches succeed', async () => {
  const calls = [];
  const publisher = createGeoPublisher({ ...options, fetch: async (url, init) => {
    assert.equal(new URL(url).origin, options.url);
    assert.equal(init.redirect, 'error');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.apikey, options.secretKey);
    assert.ok(init.signal instanceof AbortSignal);
    calls.push({ path: new URL(url).pathname, body: JSON.parse(init.body) });
    return response({ status: 'ok' });
  } });
  const invalid = snapshot(2); invalid.sources[0].source_count = 3;
  await assert.rejects(publisher.amenities(invalid));
  const malformed = snapshot(2); malformed.features[1].geometry = null;
  await assert.rejects(publisher.amenities(malformed));
  await assert.rejects(publisher.amenities({ ...snapshot(1), sources: [] }));
  const mixed = boundaries(); mixed.features[0].properties.boundary_version = 'different';
  await assert.rejects(publisher.boundaries(mixed, { boundary_version: boundaryVersion }));
  await assert.rejects(publisher.boundaries({ features: boundaries().features.slice(1) }, { boundary_version: boundaryVersion }));
  assert.equal(calls.length, 0);
  const input = snapshot(201); input.sources[0].source_url = 'https://unrelated.example/not-an-rpc';
  await publisher.amenities(input);
  assert.deepEqual(calls.map(call => call.path), ['/rest/v1/rpc/stage_geo_import', '/rest/v1/rpc/stage_geo_import', '/rest/v1/rpc/stage_geo_import', '/rest/v1/rpc/publish_neighborhood_places']);
  assert.deepEqual(calls.slice(0, 3).map(call => call.body.p_features.length), [100, 100, 1]);
  assert.equal(calls.at(-1).body.p_source.data_version, sourceVersion(input.features));
  assert.equal(new Set(calls.map(call => call.body.p_batch)).size, 1);
  calls.length = 0;
  await publisher.boundaries(boundaries(), { boundary_version: boundaryVersion });
  assert.equal(calls[0].path, '/rest/v1/rpc/stage_geo_import');
  assert.equal(calls.at(-1).path, '/rest/v1/rpc/publish_neighborhood_boundaries');
});

test('real fetch rejects redirects without forwarding the secret header to the redirect target', async t => {
  const received = [];
  const server = createServer((request, reply) => {
    received.push(request.url);
    if (request.url === '/rest/v1/rpc/stage_geo_import') { reply.writeHead(307, { Location: '/unexpected-redirect-target' }); reply.end(); }
    else { reply.writeHead(200, { 'Content-Type': 'application/json' }); reply.end('{}'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const publisher = createGeoPublisher({ secretKey: options.secretKey, url: `http://127.0.0.1:${server.address().port}` });
  await assert.rejects(publisher.amenities(snapshot(1)));
  assert.deepEqual(received, ['/rest/v1/rpc/stage_geo_import']);
});

test('checked-in full-precision datasets fit staging limits, including single large polygons', async () => {
  for (const name of ['super-neighborhood-boundaries.geojson', 'neighborhood-amenities.json']) {
    const data = JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), 'utf8'));
    const batches = featureBatches(data.features);
    assert.equal(batches.flat().length, data.features.length);
    assert.ok(batches.every(batch => batch.length <= 100 && Buffer.byteLength(JSON.stringify(batch)) <= 1_900_000));
    assert.ok(batches.filter(batch => Buffer.byteLength(JSON.stringify(batch)) > 80_000).every(batch => batch.length === 1));
  }
});
