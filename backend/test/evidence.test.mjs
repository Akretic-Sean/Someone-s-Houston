import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { REPORT_CATEGORIES, createEvidenceClient, parseEvidence } from '../dist/evidence.js';
import { coversPoint, straightLineMeters } from '../dist/prepare-evidence.js';
import { evidenceBatches, createEvidencePublisher } from '../dist/publish-evidence.js';

const config = JSON.parse(await readFile(new URL('../data/reference/report-priorities.v1.json', import.meta.url), 'utf8'));
const prepared = '2026-09-19T18:00:00Z', expires = '2026-09-19T19:00:00Z';
const source = { source_id: 'test', source_url: 'https://example.org/data', source_checked_at: prepared, source_period: null };
const entry = () => ({ availability: 'partial', facts: { count: 3 }, sources: [source], missing_inputs: ['Route'], limitations: ['Inventory only'],
  evidence_version: 'report-evidence-1234567890abcdef', prepared_at: prepared, refresh_due_at: expires, score: null, score_status: 'not_implemented' });
const body = () => ({ profile_id: config.profile_id, weight_total: 54, evaluated_at: prepared, category_definitions: config.categories,
  safety: { weighted: false, tier: null, availability: 'unavailable', reason: 'No validated tier method.' },
  neighborhoods: [{ neighborhood_id: 62, name: 'MIDTOWN', reference_point: { latitude: 29.742253, longitude: -95.375334, method: 'source_polygon_center' },
    categories: Object.fromEntries(REPORT_CATEGORIES.map(id => [id, entry()])) }], interpretation: 'Evidence, not scores.' });

test('screenshot defaults use existing frontend IDs and normalize exact raw weights', () => {
  assert.deepEqual(config.categories.map(c => c.id), REPORT_CATEGORIES);
  assert.deepEqual(config.categories.map(c => Math.round(c.default_weight / 54 * 100)), [15, 13, 11, 9, 13, 15, 11, 13]);
  assert.equal(config.categories.reduce((sum, c) => sum + c.default_weight, 0), 54);
  assert.equal(config.safety.weighted, false);
});
test('evidence rejects wrong neighborhood, absent provenance, fabricated scores, and missing categories', () => {
  assert.throws(() => parseEvidence(body(), 7));
  for (const mutate of [b => { b.neighborhoods[0].categories.food.sources = [{}]; },
    b => { b.neighborhoods[0].categories.flood.score = 90; },
    b => { delete b.neighborhoods[0].categories.food; },
    b => { b.neighborhoods[0].categories.food.availability = 'unavailable'; }]) {
    const value = body(); mutate(value); assert.throws(() => parseEvidence(value, 62));
  }
  assert.equal(parseEvidence(body(), 62).neighborhoods[0].categories.food.sources[0].source_period, null);
});
test('evidence coalesces reads, clones cached results and suppresses facts at their own deadline', async () => {
  let now = Date.parse(expires) - 1000, calls = 0;
  const client = createEvidenceClient({ url: 'https://test.supabase.co', publishableKey: 'sb_publishable_test', now: () => now,
    fetch: async (url, init) => { calls++; assert.match(url, /get_neighborhood_evidence\?p_neighborhood_id=62$/); assert.equal(init.redirect, 'error'); return new Response(JSON.stringify(body())); } });
  const [a, b] = await Promise.all([client.getEvidence({ neighborhood_id: 62 }), client.getEvidence({ neighborhood_id: 62 })]);
  assert.equal(calls, 1); a.neighborhoods[0].categories.food.facts.count = 100;
  assert.equal(b.neighborhoods[0].categories.food.facts.count, 3);
  now += 2000;
  const expired = await client.getEvidence({ neighborhood_id: 62 });
  assert.equal(calls, 1); assert.equal(expired.neighborhoods[0].categories.food.facts, null);
  assert.equal(expired.neighborhoods[0].categories.food.availability, 'needs_refresh');
  await assert.rejects(client.getEvidence({ neighborhood_id: 0 }));
  await assert.rejects(client.getEvidence({ neighborhood_id: 62, query: 'sql' }));
});
test('expired caches never silently substitute old data after a read failure', async () => {
  let now = Date.parse(prepared), fail = false;
  const client = createEvidenceClient({ url: 'https://test.supabase.co', publishableKey: 'sb_publishable_test', now: () => now, cacheMs: 100,
    fetch: async () => { if (fail) throw new Error('network'); return new Response(JSON.stringify(body())); } });
  await client.getEvidence({ neighborhood_id: 62 }); now += 101; fail = true;
  await assert.rejects(client.getEvidence({ neighborhood_id: 62 }), /network/);
});
test('point membership respects holes, shared edges, disjoint polygons and distance units', () => {
  const outer = [[-95.5, 29.5], [-95, 29.5], [-95, 30], [-95.5, 30], [-95.5, 29.5]];
  const hole = [[-95.3, 29.7], [-95.2, 29.7], [-95.2, 29.8], [-95.3, 29.8], [-95.3, 29.7]];
  const polygon = { type: 'Polygon', coordinates: [outer, hole] };
  assert.equal(coversPoint([-95.4, 29.6], polygon), true);
  assert.equal(coversPoint([-95.25, 29.75], polygon), false);
  assert.equal(coversPoint([-95.5, 29.6], polygon), true);
  assert.equal(coversPoint([-95.3, 29.75], polygon), true);
  assert.equal(coversPoint([-95.6, 29.6], polygon), false);
  assert.equal(coversPoint([-95.4, 29.6], { type: 'MultiPolygon', coordinates: [[outer, hole]] }), true);
  assert.equal(straightLineMeters([-95.3, 29.7], [-95.3, 29.7]), 0);
  assert.ok(Math.abs(straightLineMeters([-95.3, 29.7], [-95.3, 29.8]) - 11120) < 20);
});
function release() {
  return Array.from({ length: 88 }, (_, i) => REPORT_CATEGORIES.map(category_id => ({
    id: `evidence:${i + 1}:${category_id}`, neighborhood_id: i + 1, category_id, availability: 'partial', facts: { count: 3 }, sources: [source],
    missing_inputs: ['Route'], limitations: [], dependencies: [], boundary_version: 'coh-sn-boundaries-1234567890abcdef',
    evidence_version: 'report-evidence-1234567890abcdef', prepared_at: prepared, refresh_due_at: expires,
  }))).flat();
}
test('publication requires one complete version, bounded batches, and server-only credentials', async () => {
  const rows = release(), batches = evidenceBatches(rows, 10_000);
  assert.equal(batches.flat().length, 704);
  assert.ok(batches.every(b => b.length <= 100 && Buffer.byteLength(JSON.stringify(b)) <= 10_000));
  assert.throws(() => evidenceBatches(rows.slice(1)));
  const duplicate = structuredClone(rows); duplicate[1] = duplicate[0]; assert.throws(() => evidenceBatches(duplicate));
  const invalid = structuredClone(rows); invalid[1].sources = [{}]; assert.throws(() => evidenceBatches(invalid));
  assert.throws(() => createEvidencePublisher({ url: 'https://test.supabase.co', secretKey: 'sb_publishable_test' }));
  const calls = [];
  const publisher = createEvidencePublisher({ url: 'https://test.supabase.co', secretKey: 'sb_secret_test', fetch: async (url, init) => {
    assert.equal(init.redirect, 'error'); calls.push(url); return new Response('{}');
  } });
  await publisher.publish(rows);
  assert.ok(calls.slice(0, -1).every(c => c.endsWith('/stage_geo_import')));
  assert.ok(calls.at(-1).endsWith('/publish_neighborhood_evidence'));
});
