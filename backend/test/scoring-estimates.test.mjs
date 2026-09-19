import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { CATEGORY_IDS, DEFAULT_WEIGHTS, MODEL_VERSION, scoreNeighborhoods } from '../../shared/scoring.mjs';
import { scoreNeighborhoodsWithEstimates } from '../../shared/scoring-estimates.mjs';
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

function envelope() {
  const base=fixture(); base.neighborhoods[6].categories.afford.metrics.rent_usd=null;
  for(const id of [17,25,41,43,80]) base.neighborhoods[id-1].categories.flood.metrics.sfha_area_pct=null;
  const estimates=JSON.parse(readFileSync(new URL('../data/neighborhood-gap-inputs.json',import.meta.url),'utf8')).rows.map(e=>({...e,
    source_checked_at:new Date(NOW-1000).toISOString(),refresh_due_at:new Date(NOW+86400000).toISOString(),base_evidence_version:'evidence-fixture-v1'}));
  return {schema_version:1,policy_version:'source-bounded-v1',base,estimates};
}

test('six documented bounds rank all 88 with unchanged weights and preserved missing observations',()=>{
  const body=envelope(), before=JSON.stringify(body), result=scoreNeighborhoodsWithEstimates(body,options(),NOW);
  assert.equal(result.ranked.length,88);assert.equal(result.estimateInputsUsed.length,6);
  assert.deepEqual(result.effectiveWeights,DEFAULT_WEIGHTS);
  assert.equal(JSON.stringify(body),before);
  const hidden=result.results.find(r=>r.neighborhoodId===7);
  assert.equal(hidden.categories.afford.metrics.rent_usd,1999);
  assert.match(hidden.categories.afford.measurement,/Exact median unavailable/);
  assert.equal(hidden.dataQuality,'includes_conservative_bound');
  assert.equal(result.results.filter(r=>r.dataQuality==='reference_measurements').length,82);
  assert.equal(scoreNeighborhoods(body.base,options(),NOW).ranked.length,82);
});
test('buy uses observed home value and remote excludes only commute as before',()=>{
  const result=scoreNeighborhoodsWithEstimates(envelope(),options({tenure:'buy',mode:'remote'}),NOW);
  assert.equal(result.ranked.length,88);assert.equal(result.estimateInputsUsed.length,5);
  assert.equal(result.effectiveWeights.afford,8);assert.equal(result.effectiveWeights.flood,6);assert.equal(result.effectiveWeights.commute,0);
});
test('expired or superseded estimates cannot fill missing cells; observed values always win',()=>{
  const body=envelope();body.estimates[0].refresh_due_at=new Date(NOW-1).toISOString();
  assert.equal(scoreNeighborhoodsWithEstimates(body,options(),NOW).ranked.length,87);
  body.estimates[0].refresh_due_at=new Date(NOW+86400000).toISOString();body.estimates[0].base_evidence_version='old';
  assert.equal(scoreNeighborhoodsWithEstimates(body,options(),NOW).ranked.length,87);
  body.base.neighborhoods[6].categories.afford.metrics.rent_usd=1700;
  const result=scoreNeighborhoodsWithEstimates(body,options(),NOW);
  assert.equal(result.ranked.length,88);assert.equal(result.results[6].categories.afford.metrics.rent_usd,1700);
});
test('unknown IDs, unsupported bounds, future timestamps and duplicate records fail closed',()=>{
  for(const change of [e=>e.estimates.push(e.estimates[0]),e=>e.estimates[0].ranking_value=1750,e=>e.estimates[1].upper_bound=110,
    e=>e.estimates[0].source_url='https://example.org/',e=>e.estimates[0].source_checked_at=new Date(NOW+3600000).toISOString()]) {
    const body=envelope();change(body);assert.throws(()=>scoreNeighborhoodsWithEstimates(body,options(),NOW));
  }
});
test('stale base data is not revived by current estimates; disabled criteria do not consume estimates',()=>{
  const body=envelope();body.base.neighborhoods[6].categories.afford.refresh_due_at=new Date(NOW-1).toISOString();
  assert.equal(scoreNeighborhoodsWithEstimates(body,options(),NOW).ranked.length,87);
  const result=scoreNeighborhoodsWithEstimates(envelope(),options({weights:only('health')}),NOW);
  assert.equal(result.ranked.length,88);assert.equal(result.estimateInputsUsed.length,0);
});
