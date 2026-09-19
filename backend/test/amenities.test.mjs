import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fetchAmenitySource, normalizeAmenityFeature, validateAmenitySources } from '../dist/prepare-amenities.js';

const configs = validateAmenitySources(JSON.parse(await readFile(new URL('../data/reference/amenity-sources.json', import.meta.url), 'utf8')));
const config = configs.find(s => s.source_id === 'coh_libraries');
const checkedAt = '2026-09-19T00:00:00.000Z';
const metadata = {
  geometryType: 'esriGeometryPoint', maxRecordCount: 2000,
  fields: [{ name: 'OBJECTID', type: 'esriFieldTypeOID' }, { name: 'LIBRARY', type: 'esriFieldTypeString' }, { name: 'ADDRESS', type: 'esriFieldTypeString' }],
};
const feature = id => ({ type: 'Feature', properties: { OBJECTID: id, LIBRARY: `Library ${id}`, ADDRESS: ' 123 Main St ', PHONE: 'not imported' }, geometry: { type: 'Point', coordinates: [-95.345678912345, 29.789012345678] } });
const response = data => new Response(JSON.stringify(data));
function mockFetcher(mutate = () => {}) {
  let idQueries = 0;
  return async input => {
    const url = new URL(input), p = url.searchParams;
    let raw;
    if (!url.pathname.endsWith('/query')) raw = structuredClone(metadata);
    else if (p.has('returnCountOnly')) raw = { count: 3 };
    else if (p.has('returnIdsOnly')) { idQueries++; raw = { objectIdFieldName: 'OBJECTID', objectIds: [7, 1, 4] }; }
    else {
      assert.equal(p.get('outSR'), '4326');
      assert.equal(p.get('geometryPrecision'), null);
      assert.equal(p.get('maxAllowableOffset'), null);
      assert.equal(p.get('outFields'), 'OBJECTID,LIBRARY,ADDRESS');
      raw = { type: 'FeatureCollection', features: p.get('objectIds').split(',').map(Number).map(feature) };
    }
    mutate(raw, p, idQueries);
    return response(raw);
  };
}

test('fetches complete noncontiguous ID batches, keeps geometry precision, and discards unrelated fields', async () => {
  const result = await fetchAmenitySource(config, { checkedAt, pageSize: 2, fetch: mockFetcher() });
  assert.deepEqual(result.features.map(f => f.id), ['coh_libraries:1', 'coh_libraries:4', 'coh_libraries:7']);
  assert.equal(result.features[0].properties.address, '123 Main St');
  assert.equal(result.features[0].properties.PHONE, undefined);
  assert.equal(result.features[0].geometry.coordinates[0], -95.345678912345);
  assert.equal(result.sources[0].source_count, 3);
  assert.equal(result.sources[0].source_checked_at, checkedAt);
  assert.equal(result.sources[0].source_published_at, null);
  assert.equal(result.sources[0].source_period, null);
});

test('rejects partial, duplicate, or changing source records before accepting a snapshot', async () => {
  const mutations = [
    (raw, p) => { if (p.has('objectIds')) raw.features.pop(); },
    (raw, p) => { if (p.has('objectIds') && raw.features.length > 1) raw.features[1] = raw.features[0]; },
    (raw, p) => { if (p.has('objectIds')) raw.exceededTransferLimit = true; },
    (raw, p, n) => { if (p.has('returnIdsOnly') && n === 2) raw.objectIds = [1, 4, 9]; },
    (raw, p) => { if (p.has('returnCountOnly')) raw.count = 5001; },
    (raw, p) => { if (p.has('returnIdsOnly')) raw.objectIds = [1, 1, 4]; },
  ];
  for (const mutate of mutations) await assert.rejects(fetchAmenitySource(config, { checkedAt, pageSize: 2, fetch: mockFetcher(mutate) }));
});

test('enforces cumulative source byte limit across individually small responses', async () => {
  await assert.rejects(fetchAmenitySource(config, { checkedAt, maxBytes: 700, pageSize: 1, fetch: mockFetcher() }), /cumulative source size limit/);
});

test('uses read-only query POST for large ID batches that exceed gateway URL limits', async () => {
  const ids = Array.from({ length: 500 }, (_, i) => i + 10000);
  let posts = 0;
  const result = await fetchAmenitySource(config, { checkedAt, fetch: async (input, init) => {
    const url = new URL(input), p = init.body ? new URLSearchParams(init.body) : url.searchParams;
    if (!url.pathname.endsWith('/query')) return response(metadata);
    if (p.has('returnCountOnly')) return response({ count: ids.length });
    if (p.has('returnIdsOnly')) return response({ objectIdFieldName: 'OBJECTID', objectIds: ids });
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['Content-Type'], 'application/x-www-form-urlencoded');
    posts++;
    return response({ type: 'FeatureCollection', features: p.get('objectIds').split(',').map(Number).map(feature) });
  } });
  assert.equal(posts, 1);
  assert.equal(result.features.length, 500);
});

test('rejects malformed/projected or wrong geometry and does not use park attribute coordinates', () => {
  const bad = feature(1); bad.geometry.coordinates = [3_000_000, 13_000_000];
  assert.throws(() => normalizeAmenityFeature(bad, config));
  const parkConfig = configs.find(s => s.source_id === 'coh_parks');
  const park = { type: 'Feature', properties: { OBJECTID: 1, Name: 'Park', Address: null, CityMuni: 'Houston', Zip: null, Latitude: 13_000_000, Longitude: 3_000_000 }, geometry: { type: 'Polygon', coordinates: [[[-95.4, 29.7], [-95.3, 29.7], [-95.3, 29.8], [-95.4, 29.7]]] } };
  assert.deepEqual(normalizeAmenityFeature(park, parkConfig).geometry, park.geometry);
  assert.throws(() => normalizeAmenityFeature(park, config));
  park.geometry.coordinates[0].pop();
  assert.throws(() => normalizeAmenityFeature(park, parkConfig));
});

test('reviewed school edition stays explicit; schema drift and ArcGIS errors fail closed', async () => {
  const school = configs.find(s => s.source_id === 'tea_schools');
  assert.equal(school.source_period, '2024–2025 school year');
  assert.equal(school.source_published_at, null);
  const guarded = { ...config, expected_data_last_edit: 1742332855718 };
  await assert.rejects(fetchAmenitySource(guarded, { checkedAt, fetch: mockFetcher() }), /edition changed/);
  await assert.rejects(fetchAmenitySource(config, { checkedAt, fetch: mockFetcher(raw => { if (raw.fields) raw.fields.pop(); }) }), /fields changed/);
  await assert.rejects(fetchAmenitySource(config, { checkedAt, fetch: async () => response({ error: { code: 400 } }) }), /source error/);
  assert.throws(() => validateAmenitySources({ sources: [config, config] }), /Duplicate/);
});
