import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createContextClient } from '../dist/context.js';
import { createServer } from '../dist/mcp.js';

const NOW = Date.parse('2026-09-19T18:00:00Z');
const iso = offset => new Date(NOW + offset).toISOString();
const options = { url: 'https://test.supabase.co', publishableKey: 'sb_publishable_test' };
function places(count = 2) {
  return {
    type: 'FeatureCollection', neighborhood_id: 62,
    sources: [{ source_id: 'coh_parks', category: 'parks', source_url: 'https://example.gov/parks',
      source_checked_at: iso(-60_000), source_published_at: null, source_period: null, source_count: 200, published_count: 200,
      attribution: 'City of Houston', note: 'Inventory, not opening status.', data_version: 'parks-v1',
      boundary_version: 'boundaries-v1', availability: 'reference_snapshot' }],
    features: Array.from({ length: count }, (_, i) => ({ type: 'Feature', id: `park-${i}`, geometry: { type: 'Point', coordinates: [-95.4, 29.7] },
      properties: { name: `Park ${i}`, address: null, category: 'parks', source_id: 'coh_parks', neighborhood_ids: [62], location_method: 'point_on_surface' } })),
  };
}
function gauge(id = 'gauge-1', observedOffset = -60_000) {
  return { type: 'Feature', id, geometry: { type: 'Point', coordinates: [-95.4, 29.7] }, properties: {
    monitoring_location_id: 'USGS-08074810', time_series_id: id, parameter_code: '00065',
    time: iso(observedOffset), observed_at: iso(observedOffset), valid_until: iso(observedOffset + 21_600_000),
    value: 39, unit_of_measure: 'ft', approval_status: 'Provisional', qualifier: null,
    source_url: 'https://waterdata.usgs.gov/monitoring-location/USGS-08074810/',
  } };
}
function alert(expiry = 60_000) {
  return { type: 'Feature', id: 'alert-1', geometry: null, properties: {
    event: 'Flood Watch', headline: 'Flood Watch', severity: 'Severe', certainty: 'Possible', urgency: 'Future', areaDesc: 'Harris County',
    sent: iso(-60_000), sent_at: iso(-60_000), expires: iso(expiry), valid_until: iso(expiry), onset: null, ends: null,
    source_url: 'https://api.weather.gov/alerts/example',
  } };
}
function conditions(neighborhoodId = null) {
  return { checked_at: iso(0), neighborhood_id: neighborhoodId, feeds: ['nws_alerts', 'usgs_gauges'].map(source => ({
    source_id: source, source_url: source === 'nws_alerts' ? 'https://api.weather.gov/alerts/active' : 'https://api.waterdata.usgs.gov/ogcapi/v1/',
    source_checked_at: iso(0), source_published_at: iso(-60_000), valid_until: iso(1_800_000),
    attribution: 'Official provider', note: 'Operational context only.', availability: 'current', record_count: 1,
    payload: { type: 'FeatureCollection', features: source === 'nws_alerts' ? [alert()] : [gauge()] },
  })) };
}
function stub({ placeData = places(), currentData = conditions(), errorAfter = Infinity } = {}) {
  const calls = [];
  return { calls, fetch: async (url, init) => {
    calls.push({ url, init });
    assert.equal(init.method, 'GET');
    assert.equal(init.body, undefined);
    assert.equal(init.headers.apikey, options.publishableKey);
    assert.equal(init.headers.Authorization, undefined);
    assert.equal(init.redirect, 'error');
    const path = new URL(url).pathname;
    assert.ok(['/rest/v1/rpc/get_neighborhood_places', '/rest/v1/rpc/get_current_context'].includes(path));
    if (calls.length > errorAfter) return new Response('down', { status: 503 });
    return Response.json(path.endsWith('get_neighborhood_places') ? placeData : currentData);
  } };
}

test('amenities coalesce and cache all categories per neighborhood, clone results and keep unknown counts null', async () => {
  let now = NOW;
  const mock = stub();
  const client = createContextClient({ ...options, now: () => now, fetch: mock.fetch });
  const [first, second] = await Promise.all([client.getAmenities({ neighborhood_id: 62 }), client.getAmenities({ neighborhood_id: 62, category: 'parks' })]);
  assert.equal(mock.calls.length, 1);
  assert.equal(first.counts.parks, 2);
  assert.equal(first.counts.schools, null);
  assert.equal(first.availability, 'partial');
  assert.equal(second.availability, 'reference_snapshot');
  assert.equal(first.amenities[0].geometry, undefined);
  first.amenities[0].name = 'changed'; first.sources[0].note = 'changed';
  const third = await client.getAmenities({ neighborhood_id: 62 });
  assert.notEqual(third.amenities[0].name, 'changed');
  assert.notEqual(third.sources[0].note, 'changed');
  now += 3_600_001;
  await client.getAmenities({ neighborhood_id: 62 });
  assert.equal(mock.calls.length, 2);
});
test('amenity output is capped and missing inventory never becomes an authoritative zero', async () => {
  const many = createContextClient({ ...options, now: () => NOW, fetch: stub({ placeData: places(150) }).fetch });
  const output = await many.getAmenities({ neighborhood_id: 62, category: 'parks', limit: 100 });
  assert.equal(output.total_matches, 150); assert.equal(output.returned_records, 100); assert.equal(output.truncated, true);
  const empty = places(0); empty.sources = [];
  const missing = createContextClient({ ...options, now: () => NOW, fetch: stub({ placeData: empty }).fetch });
  const missingResult = await missing.getAmenities({ neighborhood_id: 62 });
  assert.equal(missingResult.availability, 'unavailable'); assert.equal(missingResult.total_matches, null);
});
test('malformed inputs and administrative keys are rejected before reads', async () => {
  const mock = stub(); const client = createContextClient({ ...options, fetch: mock.fetch });
  for (const input of [{ neighborhood_id: 89 }, { neighborhood_id: '62' }, { neighborhood_id: 62, category: 'roads' }, { neighborhood_id: 62, limit: 101 }, { neighborhood_id: 62, sql: 'select *' }]) {
    await assert.rejects(client.getAmenities(input));
  }
  for (const input of [{ neighborhood_id: 0 }, { limit: 21 }, { category: 'parks' }]) await assert.rejects(client.getCurrentConditions(input));
  assert.equal(mock.calls.length, 0);
  for (const key of ['sb_secret_admin', 'legacy.jwt.key']) assert.throws(() => createContextClient({ ...options, publishableKey: key }));
  assert.throws(() => createContextClient({ ...options, currentCacheMs: 60_001 }));
});
test('cached conditions recheck record and source expiry without refetching or leaking geometry', async () => {
  let now = NOW;
  const data = conditions(); data.feeds[0].payload.features = [alert(1_000)];
  data.feeds[1].payload.features = [gauge('old', -21_599_000), gauge('new')]; data.feeds[1].record_count = 2;
  const mock = stub({ currentData: data });
  const client = createContextClient({ ...options, now: () => now, fetch: mock.fetch });
  const [first] = await Promise.all([client.getCurrentConditions({ limit: 20 }), client.getCurrentConditions({ limit: 1 })]);
  assert.equal(mock.calls.length, 1); assert.equal(first.returned_records, 3);
  assert.equal(first.feeds[1].records[0].geometry, undefined);
  first.feeds[1].records[0].value = 999;
  now += 1_500;
  const later = await client.getCurrentConditions({ limit: 20 });
  assert.equal(mock.calls.length, 1); assert.equal(later.feeds[0].total_records, 0);
  assert.equal(later.feeds[1].total_records, 1); assert.equal(later.feeds[1].records[0].value, 39);
  assert.equal(later.returned_records, 1);
});
test('feed TTL and provider update time both prevent cached stale data from appearing current', async () => {
  let now = NOW;
  const data = conditions(); data.feeds[0].valid_until = iso(1_000);
  data.feeds[1].source_checked_at = iso(-1_799_000);
  const mock = stub({ currentData: data });
  const client = createContextClient({ ...options, now: () => now, fetch: mock.fetch });
  await client.getCurrentConditions(); now += 2_000;
  const expired = await client.getCurrentConditions();
  assert.equal(mock.calls.length, 1);
  assert.ok(expired.feeds.every(f => f.availability === 'stale' && f.total_records === null && f.records.length === 0));
  const providerOld = conditions(); providerOld.feeds[0].source_published_at = iso(-1_800_001);
  const output = await createContextClient({ ...options, now: () => NOW, fetch: stub({ currentData: providerOld }).fetch }).getCurrentConditions();
  assert.equal(output.feeds[0].availability, 'stale');
});
test('unavailable context remains distinct from fresh empty alerts and empty neighborhood gauge coverage', async () => {
  const data = conditions();
  data.feeds[0] = { source_id: 'nws_alerts', availability: 'unavailable', payload: null };
  data.feeds[1].payload.features = []; data.feeds[1].record_count = 0; data.feeds[1].availability = 'no_current_observations';
  const output = await createContextClient({ ...options, now: () => NOW, fetch: stub({ currentData: data }).fetch }).getCurrentConditions();
  assert.equal(output.feeds[0].total_records, null); assert.equal(output.feeds[0].availability, 'unavailable');
  assert.equal(output.feeds[1].total_records, 0); assert.equal(output.feeds[1].availability, 'no_current_observations');
});
test('wrong neighborhood, missing provenance and duplicate feed IDs reject API responses', async () => {
  const badPlaces = places(); badPlaces.features[0].properties.neighborhood_ids = [61];
  await assert.rejects(createContextClient({ ...options, fetch: stub({ placeData: badPlaces }).fetch }).getAmenities({ neighborhood_id: 62 }));
  const badContext = conditions(); badContext.feeds[1] = badContext.feeds[0];
  await assert.rejects(createContextClient({ ...options, fetch: stub({ currentData: badContext }).fetch }).getCurrentConditions());
  const scope = conditions(61);
  await assert.rejects(createContextClient({ ...options, fetch: stub({ currentData: scope }).fetch }).getCurrentConditions({ neighborhood_id: 62 }));
});
test('expired cache failures reject and clear inflight instead of silently returning the old value', async () => {
  let now = NOW;
  const mock = stub({ errorAfter: 1 });
  const client = createContextClient({ ...options, now: () => now, fetch: mock.fetch });
  await client.getCurrentConditions(); now += 60_001;
  await assert.rejects(client.getCurrentConditions(), /503/);
  await assert.rejects(client.getCurrentConditions(), /503/);
  assert.equal(mock.calls.length, 3);
});
test('MCP exposes six read-only tools and returns compact counts, provenance and freshness', async t => {
  const mock = stub(); const context = createContextClient({ ...options, now: () => NOW, fetch: mock.fetch });
  const server = createServer({ list: async () => { throw new Error('Profile lookup not needed.'); } }, context);
  const client = new Client({ name: 'context-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const tools = (await client.listTools()).tools;
  assert.equal(tools.length, 6); assert.ok(tools.every(tool => tool.annotations.readOnlyHint));
  const amenity = await client.callTool({ name: 'get_neighborhood_amenities', arguments: { neighborhood_id: 62, category: 'parks', limit: 1 } });
  assert.equal(amenity.isError, undefined);
  const a = JSON.parse(amenity.content[0].text); assert.equal(a.counts.parks, 2); assert.equal(a.amenities.length, 1);
  assert.equal(a.sources[0].source_published_at, null); assert.equal(a.amenities[0].geometry, undefined);
  const current = await client.callTool({ name: 'get_current_conditions', arguments: { limit: 1 } });
  assert.equal(current.isError, undefined);
  const c = JSON.parse(current.content[0].text); assert.equal(c.returned_records, 1); assert.equal(c.feeds.length, 2);
  assert.match(c.interpretation, /provisional/); assert.equal(c.feeds[0].payload, undefined);
});
