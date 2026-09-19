import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { prepareProfiles, publishProfiles } from '../dist/import-neighborhoods.js';
import { createNeighborhoodClient, filterNeighborhoods, validateProfiles, readBoundedJson } from '../dist/neighborhoods.js';
import { createServer } from '../dist/mcp.js';

const reference = JSON.parse(await readFile(new URL('../data/reference/super-neighborhoods-2024.json', import.meta.url), 'utf8'));
const raw = {
  spatialReference: { wkid: 4326 },
  features: reference.neighborhoods.map(r => ({
    attributes: { POLYID: r.neighborhood_id, SNBNAME: r.name, M_HHI: r.median_household_income, M_HV: r.median_home_value, M_GR: r.median_gross_rent },
    centroid: { x: -95.41234567, y: 29.71234567 },
  })),
};
const rows = prepareProfiles(raw, reference, '2026-09-19T00:00:00.000Z');
const response = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const options = { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' };

test('preserves missing rent and source period; version ignores retrieval date and source order', () => {
  assert.equal(rows[6].median_gross_rent, null);
  assert.deepEqual(rows[6].quality_flags, ['rent_unavailable']);
  assert.equal(rows[0].source_period_start, 2020);
  assert.equal(rows[0].source_period_end, 2024);
  assert.equal(rows[0].centroid_lon, -95.412346);
  const reordered = { ...raw, features: [...raw.features].reverse() };
  assert.equal(prepareProfiles(reordered, reference, '2026-10-01T00:00:00.000Z')[0].data_version, rows[0].data_version);
});

test('rejects incomplete, duplicate, changed, and incorrectly projected source data', () => {
  assert.throws(() => prepareProfiles({ ...raw, features: raw.features.slice(1) }, reference, rows[0].source_retrieved_at));
  assert.throws(() => prepareProfiles({ ...raw, exceededTransferLimit: true }, reference, rows[0].source_retrieved_at));
  for (const mutate of [
    input => { input.features[1] = input.features[0]; },
    input => { input.features[0].attributes.M_HHI += 1000; },
    input => { input.spatialReference.wkid = 2278; },
    input => { input.features[0].centroid.x = 3_000_000; },
    input => { input.features[0].attributes.M_GR = -666666666; },
  ]) {
    const changed = structuredClone(raw); mutate(changed);
    assert.throws(() => prepareProfiles(changed, reference, rows[0].source_retrieved_at));
  }
});

test('rejects partial or mixed-version API responses', () => {
  assert.throws(() => validateProfiles(rows.slice(0, 87)));
  const mixed = structuredClone(rows); mixed[0].data_version = 'coh-sn-2024-aaaaaaaaaaaaaaaa';
  assert.throws(() => validateProfiles(mixed), /Mixed dataset/);
  const fromPostgrest = structuredClone(rows);
  fromPostgrest.forEach(r => { r.source_retrieved_at = '2026-09-19T00:00:00+00:00'; });
  assert.equal(validateProfiles(fromPostgrest).length, 88);
});

test('coalesces concurrent reads, caches, isolates caller mutations and refreshes after expiry', async () => {
  let calls = 0, now = 0;
  const client = createNeighborhoodClient({ ...options, cacheMs: 1000, now: () => now, fetch: async (url, init) => {
    calls++;
    assert.equal(init.headers.apikey, options.publishableKey);
    assert.equal(init.headers.Authorization, undefined);
    assert.equal(new URL(url).searchParams.get('limit'), '89');
    return response(rows);
  } });
  const [a, b] = await Promise.all([client.list(), client.list()]);
  a[0].name = 'modified by consumer';
  assert.notEqual(b[0].name, a[0].name);
  assert.notEqual((await client.list())[0].name, a[0].name);
  assert.equal(calls, 1);
  now = 1001;
  await client.list(); assert.equal(calls, 2);
});

test('rejects admin credentials and does not silently serve an expired cache on failure', async () => {
  assert.throws(() => createNeighborhoodClient({ ...options, publishableKey: 'sb_secret_never' }), /publishable/);
  let calls = 0, now = 0;
  const client = createNeighborhoodClient({ ...options, cacheMs: 1, now: () => now, fetch: async () => ++calls === 1 ? response(rows) : new Response('unavailable', { status: 503 }) });
  await client.list(); now = 2;
  await assert.rejects(client.list(), /503/);
  await assert.rejects(client.list(), /503/);
  assert.equal(calls, 3);
});

test('budget filters never interpret unknown rent as free and reject unbounded input', () => {
  assert.equal(filterNeighborhoods(rows, { max_median_rent: 100_000, limit: 88 }).total_matches, 87);
  assert.equal(filterNeighborhoods(rows, { name: 'hidden valley' }).neighborhoods[0].median_gross_rent, null);
  assert.throws(() => filterNeighborhoods(rows, { limit: 1000 }));
  assert.throws(() => filterNeighborhoods(rows, { arbitrary_sql: 'select *' }));
});

test('publisher skips unchanged versions and publishes changed data with one atomic bulk write', async () => {
  const options = { url: 'https://example.supabase.co', secretKey: 'sb_secret_test' };
  let writes = 0;
  const fetcher = async (url, init) => {
    if (init.method !== 'POST') return response(rows.map(({ neighborhood_id, data_version }) => ({ neighborhood_id, data_version })));
    writes++; return new Response(null, { status: 201 });
  };
  assert.equal((await publishProfiles(rows, { ...options, fetch: fetcher })).status, 'unchanged');
  assert.equal(writes, 0);
  const empty = async (url, init) => {
    if (init.method !== 'POST') return response([]);
    writes++;
    assert.equal(JSON.parse(init.body).length, 88);
    assert.match(init.headers.Prefer, /resolution=merge-duplicates/);
    return new Response(null, { status: 201 });
  };
  assert.equal((await publishProfiles(rows, { ...options, fetch: empty })).status, 'published');
  assert.equal(writes, 1);
  await assert.rejects(publishProfiles(rows.slice(1), { ...options, fetch: empty }));
  assert.equal(writes, 1);
});

test('limits oversized upstream responses', async () => {
  await assert.rejects(readBoundedJson(response({ too: 'large' }), 3), /size limit/);
});

test('MCP discovery and tool calls return real profile data with missing-value context', async t => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({ list: async () => rows });
  const client = new Client({ name: 'neighborhood-test', version: '1.0.0' });
  t.after(async () => { await client.close(); await server.close(); });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const listing = await client.listTools();
  assert.deepEqual(listing.tools.map(x => x.name).sort(), ['compare_neighborhood_scenarios', 'get_current_conditions', 'get_neighborhood', 'get_neighborhood_amenities', 'get_neighborhood_evidence', 'get_neighborhood_relocation_context', 'list_neighborhoods']);
  const result = await client.callTool({ name: 'get_neighborhood', arguments: { neighborhood_id: 7 } });
  assert.equal(result.isError, undefined);
  const output = JSON.parse(result.content[0].text);
  assert.equal(output.neighborhood.name, 'HIDDEN VALLEY');
  assert.equal(output.neighborhood.median_gross_rent, null);
  assert.match(output.interpretation, /not current listings/);
  const filtered = await client.callTool({ name: 'list_neighborhoods', arguments: { name: 'midtown' } });
  assert.equal(JSON.parse(filtered.content[0].text).neighborhoods[0].neighborhood_id, 62);
});
