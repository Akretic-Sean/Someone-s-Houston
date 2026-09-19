import assert from 'node:assert/strict';
import test from 'node:test';
import { CATEGORY_IDS, DEFAULT_WEIGHTS, MODEL_VERSION, scoreNeighborhoods } from '../../shared/scoring.mjs';
import { scoreAllNeighborhoods } from '../../shared/scoring-coverage.mjs';
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

function gaps() {
  const p = fixture();
  p.neighborhoods[6].categories.afford.metrics.rent_usd = null;
  for (const id of [17, 25, 41, 43, 80]) p.neighborhoods[id - 1].categories.flood.metrics.sfha_area_pct = null;
  return p;
}

test('all 88 rank on identical criteria while original six exclusions and null facts remain intact', () => {
  const p = gaps(), opts = options(), before = JSON.stringify({ p, opts });
  const result = scoreAllNeighborhoods(p, opts, NOW);
  assert.equal(result.requested.ranked.length, 82);
  assert.equal(result.comparison.ranked.length, 88);
  assert.deepEqual(result.omittedCategories.map(c => c.id), ['afford', 'flood']);
  assert.deepEqual(result.omittedCategories[1].affectedNeighborhoods.map(r => r.neighborhoodId), [17, 25, 41, 43, 80]);
  assert.equal(result.retainedWeightFraction, 40 / 54);
  assert.equal(result.comparison.results[6].categories.afford.metrics.rent_usd, null);
  assert.ok(result.comparison.results.every(r => r.categories.afford.weight === 0 && r.categories.flood.weight === 0));
  assert.deepEqual(result.comparison, scoreNeighborhoods(p, options({ weights: { ...DEFAULT_WEIGHTS, afford: 0, flood: 0 } }), NOW));
  assert.equal(JSON.stringify({ p, opts }), before);
});

test('buy retains affordability; remote removes commute globally; disabled missing priorities are not listed as omitted', () => {
  const result = scoreAllNeighborhoods(gaps(), options({ tenure: 'buy', mode: 'remote' }), NOW);
  assert.equal(result.comparison.ranked.length, 88);
  assert.deepEqual(result.omittedCategories.map(c => c.id), ['flood']);
  assert.equal(result.comparison.effectiveWeights.commute, 0);
  assert.equal(result.retainedWeightFraction, 41 / 47);
  const disabled = scoreAllNeighborhoods(gaps(), options({ weights: { ...DEFAULT_WEIGHTS, afford: 0, flood: 0 } }), NOW);
  assert.deepEqual(disabled.omittedCategories, []);
  assert.equal(disabled.retainedWeightFraction, 1);
});

test('complete evidence produces identical requested and common rankings without omissions', () => {
  const result = scoreAllNeighborhoods(fixture(), options(), NOW);
  assert.deepEqual(result.comparison, result.requested);
  assert.deepEqual(result.omittedCategories, []);
});

test('a newly expired measurement drops that category for everyone, never leaks stale metrics', () => {
  const p = gaps(); p.neighborhoods[0].categories.health.refresh_due_at = new Date(NOW - 1).toISOString();
  const result = scoreAllNeighborhoods(p, options(), NOW);
  assert.equal(result.comparison.ranked.length, 88);
  assert.deepEqual(result.omittedCategories.map(c => c.id), ['afford', 'flood', 'health']);
  assert.ok(Object.values(result.comparison.results[0].categories.health.metrics).every(v => v === null));
});

test('no common selected priority, all expired data and incomplete cohorts fail without invented scores', () => {
  assert.throws(() => scoreAllNeighborhoods(gaps(), options({ weights: only('flood') }), NOW), e => e.code === 'NO_COMMON_CATEGORIES');
  assert.throws(() => scoreAllNeighborhoods(gaps(), options(), Date.parse(DUE)), e => e.code === 'NO_CURRENT_DATA');
  const p = gaps(); p.neighborhoods.pop();
  assert.throws(() => scoreAllNeighborhoods(p, options(), NOW), e => e.code === 'INVALID_PAYLOAD');
});
