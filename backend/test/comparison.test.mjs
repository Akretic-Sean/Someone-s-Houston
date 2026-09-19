import assert from 'node:assert/strict';
import test from 'node:test';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { CATEGORY_IDS, DEFAULT_WEIGHTS, MODEL_VERSION, scoreNeighborhoods } from '../../shared/scoring.mjs';
import { compareScenarios, createComparisonClient } from '../dist/comparison.js';
import { createServer } from '../dist/mcp.js';
const NOW = Date.parse('2026-09-19T20:00:00Z');
const DUE = '2026-10-19T20:00:00Z';
const options = overrides => ({ weights: { ...DEFAULT_WEIGHTS }, tenure: 'rent', mode: 'offer', office: 'ion', airport: 'nearest', ...overrides });
const only = id => Object.fromEntries(CATEGORY_IDS.map(key => [key, key === id ? 10 : 0]));
const fixture = () => ({
  schema_version: 1,
  model_version: MODEL_VERSION,
  evaluated_at: '2026-09-19T19:00:00Z',
  category_definitions: CATEGORY_IDS.map(id => ({ id, label: id, default_weight: DEFAULT_WEIGHTS[id] })),
  neighborhoods: Array.from({ length: 88 }, (_, index) => {
    const id = index + 1;
    const metrics = {
      afford: { rent_usd: 1000 + id, home_value_usd: 400000 - id * 1000 },
      commute: { ion: id * 100, downtown: (89 - id) * 100, energy: id * 200, tmc: id * 300, nasa: id * 400 },
      flood: { sfha_area_pct: id / 2 },
      amen: { libraries: id * 100, museums: id * 200, community_centers: id * 300, multi_service_centers: id * 400 },
      fit: { parks: id * 100, community_centers: id * 200 },
      food: { grocery_stores: id * 100 },
      air: { iah: id * 100, hou: (89 - id) * 150 },
      health: { hospitals: id * 100, health_facilities: id * 200, multi_service_centers: id * 300 },
    };
    return {
      neighborhood_id: id, name: `Neighborhood ${id}`,
      reference_point: { latitude: 29.75, longitude: -95.37 },
      categories: Object.fromEntries(CATEGORY_IDS.map(category => [category, {
        availability: 'partial', refresh_due_at: DUE, evidence_version: 'evidence-fixture-v1', metrics: metrics[category],
      }])),
    };
  }),
});

const input = () => ({ baseline: options(), alternative: options({ mode: 'remote' }), limit: 3 });
const config = { url: 'https://test.supabase.co', publishableKey: 'sb_publishable_test' };

test('comparison exactly matches shared rankings and signed margin reconciles', () => {
  const payload = fixture(), args = input();
  const result = compareScenarios(payload, args, NOW);
  const shared = scoreNeighborhoods(payload, args.baseline, NOW);
  assert.deepEqual(result.baseline.shortlist, shared.ranked.slice(0, 3));
  const margin = result.baseline.winner_margin;
  assert.ok(Math.abs(margin.categories.reduce((sum, c) => sum + c.points, 0) - margin.total_points) < 1e-10);
  assert.equal(result.alternative.effective_weights.commute, 0);
  assert.equal(result.rank_changes.length, 88);
  const updated = structuredClone(payload); updated.evaluated_at = new Date(NOW).toISOString();
  assert.equal(compareScenarios(updated, args, NOW).snapshot_sha256, result.snapshot_sha256);
  updated.neighborhoods[0].categories.afford.metrics.rent_usd++;
  assert.notEqual(compareScenarios(updated, args, NOW).snapshot_sha256, result.snapshot_sha256);
});

test('missing inputs remain exclusions and changes in eligibility have null movement', () => {
  const payload = fixture(); payload.neighborhoods[0].categories.afford.metrics.rent_usd = null;
  const result = compareScenarios(payload, { baseline: options(), alternative: options({ tenure: 'buy' }) }, NOW);
  assert.equal(result.baseline.ranked_count, 87);
  assert.match(result.baseline.excluded[0].reasons[0].reason, /rent_usd/);
  assert.equal(result.rank_changes[0].baseline_rank, null);
  assert.equal(result.rank_changes[0].rank_improvement, null);
  assert.equal(result.alternative.ranked_count, 88);
});

test('coalesces reads and does not reuse caller mutations or expired snapshots on failure', async () => {
  let clock = NOW, calls = 0, outage = false;
  const client = createComparisonClient({ ...config, now: () => clock, cacheMs: 1000, fetch: async () => {
    calls++; if (outage) throw new Error('outage'); return Response.json(fixture());
  } });
  const [a, b] = await Promise.all([client.compare(input()), client.compare(input())]);
  assert.equal(calls, 1);
  a.baseline.shortlist[0].categories.afford.metrics.rent_usd = 0;
  assert.notEqual(b.baseline.shortlist[0].categories.afford.metrics.rent_usd, 0);
  assert.deepEqual((await client.compare(input())).baseline, b.baseline);
  clock += 1001; outage = true;
  await assert.rejects(client.compare(input()), /outage/);
  await assert.rejects(client.compare(input()), /outage/);
  assert.equal(calls, 3);
});

test('validates preferences before reading, source expiry and admin credentials', async () => {
  let calls = 0;
  const client = createComparisonClient({ ...config, now: () => Date.parse(DUE), fetch: async () => { calls++; return Response.json(fixture()); } });
  await assert.rejects(client.compare({ ...input(), limit: 6 }));
  await assert.rejects(client.compare({ ...input(), alternative: options({ mode: 'remote', weights: only('commute') }) }));
  assert.equal(calls, 0);
  await assert.rejects(client.compare(input()), /No current scoring/);
  assert.throws(() => createComparisonClient({ ...config, publishableKey: 'sb_secret_test' }));
});

test('MCP comparison returns shared model results through a read-only tool', async t => {
  const comparison = createComparisonClient({ ...config, now: () => NOW, fetch: async () => Response.json(fixture()) });
  const server = createServer({ list: async () => [] }, undefined, undefined, undefined, comparison);
  const client = new Client({ name: 'comparison-test', version: '1.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await Promise.all([server.connect(a), client.connect(b)]);
  const tool = (await client.listTools()).tools.find(t => t.name === 'compare_neighborhood_scenarios');
  assert.equal(tool.annotations.readOnlyHint, true);
  const result = await client.callTool({ name: tool.name, arguments: input() });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.model_version, MODEL_VERSION);
  assert.equal(result.structuredContent.baseline.ranked_count, 88);
});
