import test from 'node:test';
import assert from 'node:assert/strict';
import { createScoringClient, nextScoringDeadline, readBoundedJson } from '../src/data/scoringClient.mjs';
import { CATEGORY_IDS, DEFAULT_WEIGHTS } from '../../../shared/scoring.mjs';

const URL = 'https://hknzivrgihnqzvsafkkr.supabase.co';
const KEY = 'sb_publishable_test_key_not_a_real_key';
const START = Date.parse('2026-09-19T20:00:00Z');
function baseSnapshot(due = START + 86_400_000) {
  const metrics = {
    afford: { rent_usd: 1300, home_value_usd: 200000 },
    commute: { ion: 1000, downtown: 2000, energy: 3000, tmc: 4000, nasa: 5000 },
    flood: { sfha_area_pct: 5 },
    amen: { libraries: 1000, museums: 2000, community_centers: 3000, multi_service_centers: 4000 },
    fit: { parks: 1000, community_centers: 3000 },
    food: { grocery_stores: 1000 }, air: { iah: 30000, hou: 20000 },
    health: { hospitals: 1000, health_facilities: 2000, multi_service_centers: 4000 },
  };
  return {
    schema_version: 1, model_version: 'houston-access-v2', evaluated_at: new Date(START).toISOString(),
    category_definitions: CATEGORY_IDS.map(id => ({ id, label: id, default_weight: DEFAULT_WEIGHTS[id] })),
    neighborhoods: Array.from({ length: 88 }, (_, index) => ({
      neighborhood_id: index + 1, name: `Neighborhood ${index + 1}`,
      reference_point: { latitude: 29.7, longitude: -95.3 },
      categories: Object.fromEntries(CATEGORY_IDS.map(id => [id, {
        ...(['amen', 'health'].includes(id) ? { nearby_access: { radius_meters: 4828.032, facilities: Object.fromEntries(Object.keys(metrics[id]).map(key => [key, { count: 2, weighted_count: 1 }])) } } : {}),
        availability: 'partial', refresh_due_at: new Date(due).toISOString(), evidence_version: 'test-evidence-1', metrics: structuredClone(metrics[id]),
      }])),
    })),
  };
}

function snapshot(due) { return { schema_version: 1, policy_version: 'source-bounded-v1', base: baseSnapshot(due), estimates: [] }; }

test('coalesces concurrent reads, caches for one hour from fetch, and isolates callers', async () => {
  let calls = 0, time = START;
  const client = createScoringClient({ url: URL, key: KEY, now: () => time, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, `${URL}/rest/v1/rpc/get_neighborhood_access_scoring_data`);
    assert.equal(options.method, 'POST');
    assert.equal(options.body, '{}');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.apikey, KEY);
    assert.equal(options.headers.Authorization, undefined);
    return Response.json(snapshot());
  } });
  const [first, second] = await Promise.all([client.load(), client.load()]);
  assert.equal(calls, 1);
  first.base.neighborhoods[0].name = 'mutated';
  assert.equal(second.base.neighborhoods[0].name, 'Neighborhood 1');
  time += 3_599_000;
  assert.equal((await client.load()).base.neighborhoods[0].name, 'Neighborhood 1');
  assert.equal(client.nextRefreshAt(), START + 3_600_000);
  assert.equal(calls, 1);
  time += 1000;
  await client.load();
  assert.equal(calls, 2);
});

test('an earlier source deadline expires the cache and an outage never falls back to old facts', async () => {
  let time = START, fail = false, calls = 0;
  const client = createScoringClient({ url: URL, key: KEY, now: () => time, fetchImpl: async () => {
    calls++;
    return fail ? new Response('', { status: 503 }) : Response.json(snapshot(time + 1000));
  } });
  await client.load();
  assert.equal(client.nextRefreshAt(), START + 1000);
  time += 1000;
  fail = true;
  await assert.rejects(client.load(), /503/);
  assert.equal(client.nextRefreshAt(), null);
  fail = false;
  await client.load();
  assert.equal(calls, 3);
});

test('rejects secret keys, wrong projects, and partial cohorts before caching', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return Response.json({}); };
  await assert.rejects(createScoringClient({ url: URL, key: 'sb_secret_not_for_browsers', fetchImpl }).load(), /publishable/);
  await assert.rejects(createScoringClient({ url: 'https://other.example', key: KEY, fetchImpl }).load(), /project URL/);
  assert.equal(calls, 0);
  const partial = snapshot(); partial.base.neighborhoods.pop();
  const client = createScoringClient({ url: URL, key: KEY, fetchImpl: async () => Response.json(partial) });
  await assert.rejects(client.load(), /88-neighborhood/);
  assert.equal(client.nextRefreshAt(), null);
});

test('bounded reads measure bytes, cancel streaming overflow and reject invalid JSON', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(20)); }, cancel() { cancelled = true; } });
  await assert.rejects(readBoundedJson(new Response(stream), 10), /size limit/);
  assert.equal(cancelled, true);
  await assert.rejects(readBoundedJson(new Response('"éé"'), 5), /size limit/);
  await assert.rejects(readBoundedJson(new Response('not json')), SyntaxError);
  assert.deepEqual(await readBoundedJson(Response.json({ hello: 'world' })), { hello: 'world' });
});

test('expiry selection ignores already expired rows to avoid a retry loop', () => {
  const payload = snapshot(START - 1);
  assert.equal(nextScoringDeadline(payload, START), null);
  payload.base.neighborhoods[0].categories.afford.refresh_due_at = new Date(START + 5000).toISOString();
  assert.equal(nextScoringDeadline(payload, START), START + 5000);
});

test('estimate expiry bounds the cache; malformed envelopes and failed refreshes fail closed', async () => {
  const body = snapshot();
  body.base.neighborhoods[6].categories.afford.metrics.rent_usd = null;
  body.estimates = [{ neighborhood_id: 7, category_id: 'afford', metric: 'rent_usd',
    lower_bound: 1500, upper_bound: 1999, ranking_value: 1999, method: 'conservative_upper_bound',
    source_url: 'https://www.houstontx.gov/planning/Demographics/sn-demographics-2024/6-Gross-Rent-2024.pdf',
    source_period: 'ACS 2020-2024', source_checked_at: new Date(START - 1000).toISOString(),
    refresh_due_at: new Date(START + 1000).toISOString(), source_sha256: 'a'.repeat(64),
    boundary_version: 'coh-sn-boundaries-' + 'a'.repeat(16), base_evidence_version: 'test-evidence-1',
    audit: {}, limitation: 'Exact median suppressed; upper band endpoint only.' }];
  let time = START, fail = false;
  const client = createScoringClient({ url: URL, key: KEY, now: () => time,
    fetchImpl: async () => fail ? new Response('', { status: 503 }) : Response.json(body) });
  const loaded = await client.load();
  assert.equal(loaded.base.neighborhoods[6].categories.afford.metrics.rent_usd, null);
  assert.equal(loaded.estimates.length, 1);
  assert.equal(client.nextRefreshAt(), START + 1000);
  time += 1000; fail = true;
  await assert.rejects(client.load(), /503/);
  assert.equal(client.nextRefreshAt(), null);
  fail = false; body.estimates[0].ranking_value = 1700;
  await assert.rejects(client.load(), /malformed estimate/);
});
