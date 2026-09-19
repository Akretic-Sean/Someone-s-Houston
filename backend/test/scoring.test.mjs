import assert from 'node:assert/strict';
import test from 'node:test';
import { CATEGORY_IDS, DEFAULT_WEIGHTS, MODEL_VERSION, ScoringValidationError, scoreNeighborhoods, validateScoringPayload } from '../../shared/scoring.mjs';

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

test('lower costs, distances and mapped flood exposure score better without altering inputs', () => {
  const payload = fixture();
  const before = JSON.stringify(payload);
  const preference = options();
  const beforeOptions = JSON.stringify(preference);
  const output = scoreNeighborhoods(payload, preference, NOW);
  assert.equal(output.ranked.length, 88);
  assert.equal(output.results[0].categories.afford.score, 100);
  assert.equal(output.results[87].categories.afford.score, 0);
  assert.equal(output.results[0].categories.flood.score, 100);
  assert.equal(output.results[87].categories.flood.score, 0);
  assert.equal(output.results[0].categories.amen.score, 100);
  assert.equal(output.results[87].categories.amen.score, 0);
  assert.ok(output.results.every(row => row.totalScore >= 0 && row.totalScore <= 100));
  assert.equal(JSON.stringify(payload), before);
  assert.equal(JSON.stringify(preference), beforeOptions);
  assert.equal(output.modelVersion, MODEL_VERSION);
  assert.equal(output.evaluatedAt, new Date(NOW).toISOString());
});

test('rent/buy and selected office change the measurements and resulting rankings', () => {
  const payload = fixture();
  const rent = scoreNeighborhoods(payload, options({ weights: only('afford') }), NOW);
  const buy = scoreNeighborhoods(payload, options({ weights: only('afford'), tenure: 'buy' }), NOW);
  assert.equal(rent.ranked[0].neighborhoodId, 1);
  assert.equal(buy.ranked[0].neighborhoodId, 88);
  assert.deepEqual(buy.ranked[0].categories.afford.metrics, { home_value_usd: 312000 });
  const ion = scoreNeighborhoods(payload, options({ weights: only('commute') }), NOW);
  const downtown = scoreNeighborhoods(payload, options({ weights: only('commute'), office: 'downtown' }), NOW);
  assert.equal(ion.ranked[0].neighborhoodId, 1);
  assert.equal(downtown.ranked[0].neighborhoodId, 88);
});

test('airport selection uses selected proxy or minimum of both available distances', () => {
  const payload = fixture();
  const iah = scoreNeighborhoods(payload, options({ weights: only('air'), airport: 'iah' }), NOW);
  const hou = scoreNeighborhoods(payload, options({ weights: only('air'), airport: 'hou' }), NOW);
  const nearest = scoreNeighborhoods(payload, options({ weights: only('air') }), NOW);
  assert.equal(iah.ranked[0].neighborhoodId, 1);
  assert.equal(hou.ranked[0].neighborhoodId, 88);
  assert.equal(nearest.ranked[0].neighborhoodId, 1);
  assert.equal(nearest.results[87].categories.air.metrics.nearest_airport_meters, 150);
  payload.neighborhoods[0].categories.air.metrics.hou = null;
  assert.equal(scoreNeighborhoods(payload, options({ weights: only('air') }), NOW).results[0].totalScore, null);
  assert.equal(scoreNeighborhoods(payload, options({ weights: only('air'), airport: 'iah' }), NOW).results[0].totalScore, 100);
});

test('remote mode excludes commute globally and recalculates common weights', () => {
  const payload = fixture();
  const weights = { ...only('afford'), commute: 10 };
  const offer = scoreNeighborhoods(payload, options({ weights, office: 'downtown' }), NOW);
  const remote = scoreNeighborhoods(payload, options({ weights, office: 'downtown', mode: 'remote' }), NOW);
  assert.equal(offer.normalizedWeights.commute, 0.5);
  assert.equal(remote.effectiveWeights.commute, 0);
  assert.equal(remote.normalizedWeights.afford, 1);
  assert.equal(remote.results[0].totalScore, 100);
  assert.equal(remote.results[87].totalScore, 0);
  assert.equal(offer.results[0].totalScore, 50);
  assert.equal(offer.results[87].totalScore, 50);
});

test('observed missing-rent and five missing-flood pattern gives 82 rent / 83 buy eligible rows', () => {
  const payload = fixture();
  payload.neighborhoods[6].categories.afford.metrics.rent_usd = null;
  for (const id of [17, 25, 41, 43, 80]) payload.neighborhoods[id - 1].categories.flood.metrics.sfha_area_pct = null;
  const rent = scoreNeighborhoods(payload, options(), NOW);
  const buy = scoreNeighborhoods(payload, options({ tenure: 'buy' }), NOW);
  assert.equal(rent.ranked.length, 82);
  assert.equal(buy.ranked.length, 83);
  assert.equal(rent.results.length, 88);
  assert.deepEqual(rent.results[6].missingCategories, ['afford']);
  assert.deepEqual(buy.results[6].missingCategories, []);
  assert.deepEqual(rent.results[16].missingCategories, ['flood']);
  assert.equal(rent.results[16].rank, null);
  assert.equal(rent.results[16].totalScore, null);
  assert.equal(rent.results[16].categories.flood.score, null);
});

test('missing unweighted categories do not block totals or redistribute any other weights', () => {
  const payload = fixture();
  payload.neighborhoods[0].categories.flood.metrics.sfha_area_pct = null;
  const output = scoreNeighborhoods(payload, options({ weights: { ...DEFAULT_WEIGHTS, flood: 0 } }), NOW);
  assert.equal(output.ranked.length, 88);
  assert.deepEqual(output.results[0].missingCategories, []);
  assert.equal(output.results[0].categories.flood.score, null);
  assert.equal(output.results[0].categories.afford.normalizedWeight, output.results[87].categories.afford.normalizedWeight);
  assert.equal(output.results[0].categories.afford.normalizedWeight, 8 / 48);
});

test('component percentiles use the fixed usable cohort independent of total eligibility and weights', () => {
  const payload = fixture();
  const baseline = scoreNeighborhoods(payload, options(), NOW);
  for (let index = 0; index < 40; index++) payload.neighborhoods[index].categories.flood.metrics.sfha_area_pct = null;
  const partial = scoreNeighborhoods(payload, options(), NOW);
  const differentlyWeighted = scoreNeighborhoods(payload, options({ weights: only('afford') }), NOW);
  assert.equal(partial.results[40].categories.afford.score, baseline.results[40].categories.afford.score);
  assert.equal(differentlyWeighted.results[40].categories.afford.score, baseline.results[40].categories.afford.score);
  assert.equal(partial.results[40].categories.afford.score, 100 * 47 / 87);
});

test('normalize each proximity component before equal category averaging', () => {
  const payload = fixture();
  for (const row of payload.neighborhoods) {
    row.categories.fit.metrics.parks = row.neighborhood_id;
    row.categories.fit.metrics.community_centers = (89 - row.neighborhood_id) * 100000;
  }
  const output = scoreNeighborhoods(payload, options({ weights: only('fit') }), NOW);
  for (const row of output.results) assert.ok(Math.abs(row.categories.fit.score - 50) < 1e-12);
  payload.neighborhoods[0].categories.fit.metrics.community_centers = null;
  const missing = scoreNeighborhoods(payload, options({ weights: only('fit') }), NOW);
  assert.equal(missing.results[0].categories.fit.score, null);
  assert.match(missing.results[0].categories.fit.reason, /community_centers/);
  assert.ok(Math.abs(missing.results[1].categories.fit.score - ((100 * 86 / 87) + 0) / 2) < 1e-12);
});

test('ties use midranks, constants use neutral 50 and ties resolve by canonical ID', () => {
  const payload = fixture();
  for (const row of payload.neighborhoods) row.categories.food.metrics.grocery_stores = 123;
  let output = scoreNeighborhoods(payload, options({ weights: only('food') }), NOW);
  assert.ok(output.results.every(row => row.totalScore === 50));
  assert.deepEqual(output.ranked.map(row => row.neighborhoodId), Array.from({ length: 88 }, (_, index) => index + 1));
  payload.neighborhoods[0].categories.food.metrics.grocery_stores = 0;
  payload.neighborhoods[1].categories.food.metrics.grocery_stores = 0;
  output = scoreNeighborhoods(payload, options({ weights: only('food') }), NOW);
  assert.equal(output.ranked[0].totalScore, 100 * 86.5 / 87);
  assert.equal(output.ranked[1].totalScore, output.ranked[0].totalScore);
  payload.neighborhoods.reverse();
  assert.deepEqual(scoreNeighborhoods(payload, options({ weights: only('food') }), NOW), output);
});

test('expired and unavailable category metrics cannot create a score or leak stale facts', () => {
  const payload = fixture();
  payload.neighborhoods[0].categories.afford.refresh_due_at = new Date(NOW).toISOString();
  payload.neighborhoods[1].categories.afford.availability = 'needs_refresh';
  payload.neighborhoods[2].categories.afford = {
    availability: 'unavailable', refresh_due_at: null, evidence_version: null,
    metrics: { rent_usd: null, home_value_usd: null },
  };
  const output = scoreNeighborhoods(payload, options(), NOW);
  assert.equal(output.ranked.length, 85);
  assert.match(output.results[0].categories.afford.reason, /expired/);
  assert.match(output.results[1].categories.afford.reason, /needs refresh/);
  assert.match(output.results[2].categories.afford.reason, /unavailable/);
  for (let index = 0; index < 3; index++) assert.equal(output.results[index].categories.afford.metrics.rent_usd, null);
  assert.equal(output.results[3].categories.afford.score, 100);
});

test('no active priorities and invalid preference values fail with actionable errors', () => {
  const payload = fixture();
  const zeros = Object.fromEntries(CATEGORY_IDS.map(id => [id, 0]));
  assert.throws(() => scoreNeighborhoods(payload, options({ weights: zeros }), NOW), error => error instanceof ScoringValidationError && error.code === 'NO_ACTIVE_WEIGHTS');
  assert.throws(() => scoreNeighborhoods(payload, options({ weights: only('commute'), mode: 'remote' }), NOW), /non-commute/);
  for (const value of [NaN, Infinity, -1, 11, '8', null]) assert.throws(() => scoreNeighborhoods(payload, options({ weights: { ...DEFAULT_WEIGHTS, afford: value } }), NOW), /all eight priority weights/);
  for (const overrides of [{ tenure: 'mortgage' }, { mode: 'hybrid' }, { office: 'other' }, { airport: 'other' }]) assert.throws(() => scoreNeighborhoods(payload, options(overrides), NOW), /valid housing mode/);
  assert.throws(() => scoreNeighborhoods(payload, options({ weights: { afford: 8 } }), NOW), /all eight/);
  for (const now of [NaN, Infinity, 1e100]) assert.throws(() => scoreNeighborhoods(payload, options(), now), error => error.code === 'INVALID_TIME');
});

test('incomplete cohorts, mixed versions, malformed dates and invalid metrics fail closed', () => {
  const corruptions = [
    payload => { payload.neighborhoods.pop(); },
    payload => { payload.neighborhoods[0].neighborhood_id = 2; },
    payload => { payload.neighborhoods[0].categories.food.evidence_version = 'other-version'; },
    payload => { payload.neighborhoods[0].categories.food.evidence_version = null; },
    payload => { payload.neighborhoods[0].categories.food.refresh_due_at = null; },
    payload => { payload.neighborhoods[0].categories.food.refresh_due_at = '2026-02-30T00:00:00Z'; },
    payload => { payload.neighborhoods[0].categories.food.refresh_due_at = '2026-10-01T24:00:00Z'; },
    payload => { payload.neighborhoods[0].categories.food.refresh_due_at = 'next month'; },
    payload => { payload.neighborhoods[0].categories.food.metrics.grocery_stores = -1; },
    payload => { payload.neighborhoods[0].categories.food.metrics.grocery_stores = '0'; },
    payload => { payload.neighborhoods[0].categories.food.metrics.grocery_stores = Infinity; },
    payload => { payload.neighborhoods[0].categories.flood.metrics.sfha_area_pct = 101; },
    payload => { payload.neighborhoods[0].categories.afford.metrics.rent_usd = 0; },
    payload => { delete payload.neighborhoods[0].categories.food.metrics.grocery_stores; },
    payload => { payload.neighborhoods[0].reference_point.latitude = NaN; },
    payload => { payload.category_definitions[0].default_weight = 10; },
    payload => { payload.category_definitions[0].id = 'commute'; },
    payload => { payload.schema_version = 2; },
    payload => { payload.model_version = 'unknown'; },
  ];
  for (const corrupt of corruptions) {
    const payload = fixture();
    corrupt(payload);
    assert.throws(() => validateScoringPayload(payload), error => error instanceof ScoringValidationError && error.code === 'INVALID_PAYLOAD');
  }
});

test('unsupported future evaluation time and entirely expired snapshots cannot generate reports', () => {
  const payload = fixture();
  payload.evaluated_at = '2026-09-20T00:00:00Z';
  assert.throws(() => scoreNeighborhoods(payload, options(), NOW), /future/);
  payload.evaluated_at = '2026-09-19T00:00:00Z';
  for (const row of payload.neighborhoods) for (const category of Object.values(row.categories)) category.refresh_due_at = '2026-09-19T19:59:59Z';
  assert.equal(validateScoringPayload(payload), payload);
  assert.throws(() => scoreNeighborhoods(payload, options(), NOW), error => error.code === 'NO_CURRENT_DATA');
});

test('the weighted total is the unrounded category sum, not rounded slider percentages', () => {
  const result = scoreNeighborhoods(fixture(), options(), NOW);
  for (const row of result.ranked) {
    const expected = CATEGORY_IDS.reduce((sum, id) => sum + row.categories[id].score * DEFAULT_WEIGHTS[id] / 54, 0);
    assert.ok(Math.abs(row.totalScore - expected) < 1e-12);
  }
  assert.ok(result.ranked.some(row => row.totalScore !== Math.round(row.totalScore)));
});

function accessFixture() {
  const payload = fixture();
  payload.model_version = 'houston-access-v2';
  for (const row of payload.neighborhoods) for (const id of ['amen', 'health']) {
    row.categories[id].nearby_access = { radius_meters: 4828.032,
      facilities: Object.fromEntries(Object.keys(row.categories[id].metrics).map(key => [key, { count: 1, weighted_count: 0.5 }])) };
  }
  return payload;
}

test('nearby access favors both more options and closer options, independently of boundary counts and nearest distance', () => {
  for (const id of ['amen', 'health']) {
    const payload = accessFixture();
    const a = payload.neighborhoods[0].categories[id];
    const b = payload.neighborhoods[1].categories[id];
    // Same nearest distances, but two facilities one mile away vs one.
    b.metrics = { ...a.metrics };
    for (const key of Object.keys(a.metrics)) {
      a.nearby_access.facilities[key] = { count: 1, weighted_count: 2 / 3 };
      b.nearby_access.facilities[key] = { count: 2, weighted_count: 4 / 3 };
    }
    const result = scoreNeighborhoods(payload, options({ weights: only(id) }), NOW);
    assert.ok(result.results[1].totalScore > result.results[0].totalScore);
    // Equal counts: moving the second area's facility from one to two miles loses credit.
    for (const key of Object.keys(b.metrics)) b.nearby_access.facilities[key] = { count: 1, weighted_count: 1 / 3 };
    const moved = scoreNeighborhoods(payload, options({ weights: only(id) }), NOW);
    assert.ok(moved.results[0].totalScore > moved.results[1].totalScore);
    assert.equal(moved.modelVersion, 'houston-access-v2');
  }
});

test('nearby zero is observed; missing or expired access is withheld and never replaced by nearest-only scoring', () => {
  const payload = accessFixture();
  const a = payload.neighborhoods[0].categories.amen;
  for (const key of Object.keys(a.metrics)) { a.nearby_access.facilities[key] = { count: 0, weighted_count: 0 }; a.metrics[key] = null; }
  assert.equal(scoreNeighborhoods(payload, options({ weights: only('amen') }), NOW).results[0].totalScore, 0);
  a.nearby_access.facilities.libraries = null;
  assert.equal(scoreNeighborhoods(payload, options({ weights: only('amen') }), NOW).results[0].totalScore, null);
  a.refresh_due_at = '2026-09-18T20:00:00Z';
  assert.equal(scoreNeighborhoods(payload, options(), NOW).results[0].categories.amen.nearbyAccess, null);
});

test('rejects malformed nearby access and preserves input immutability', () => {
  const payload = accessFixture(), before = structuredClone(payload);
  scoreNeighborhoods(payload, options(), NOW);
  assert.deepEqual(payload, before);
  for (const mutate of [
    a => { a.radius_meters = 1609.344; },
    a => { delete a.facilities.libraries; },
    a => { a.facilities.libraries = { count: 0, weighted_count: 1 }; },
    a => { a.facilities.libraries = { count: 1.5, weighted_count: 1 }; },
    a => { a.facilities.libraries = { count: 2, weighted_count: NaN }; },
  ]) {
    const copy = structuredClone(payload); mutate(copy.neighborhoods[0].categories.amen.nearby_access);
    assert.throws(() => scoreNeighborhoods(copy, options(), NOW), ScoringValidationError);
  }
});
