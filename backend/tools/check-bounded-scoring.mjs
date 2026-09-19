import assert from 'node:assert/strict';
import { readBoundedJson, supabaseBaseUrl } from '../dist/neighborhoods.js';
import { DEFAULT_WEIGHTS } from '../../shared/scoring.mjs';
import { scoreNeighborhoodsWithEstimates } from '../../shared/scoring-estimates.mjs';
try {
  const url = supabaseBaseUrl(process.env.SUPABASE_URL), key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key ?? '')) throw new Error('Public configuration required');
  const start=performance.now();
  const envelope=await readBoundedJson(await fetch(`${url}/rest/v1/rpc/get_neighborhood_scoring_data_with_estimates`, {
    method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:'{}',redirect:'error',signal:AbortSignal.timeout(15000),
  }),350000);
  const rows=[];
  for(const tenure of ['rent','buy']) for(const mode of ['offer','remote']) {
    const result=scoreNeighborhoodsWithEstimates(envelope,{tenure,mode,office:'ion',airport:'nearest',weights:{...DEFAULT_WEIGHTS}});
    assert.equal(result.ranked.length,88);
    assert.equal(result.effectiveWeights.afford,DEFAULT_WEIGHTS.afford);
    assert.equal(result.effectiveWeights.flood,DEFAULT_WEIGHTS.flood);
    assert.equal(result.estimateInputsUsed.length,tenure==='rent'?6:5);
    rows.push({tenure,mode,ranked:result.ranked.length,estimated_inputs:result.estimateInputsUsed.length,weights:result.effectiveWeights});
  }
  assert.equal(envelope.base.neighborhoods.find(n=>n.neighborhood_id===7).categories.afford.metrics.rent_usd,null);
  console.log(JSON.stringify({status:'passed',checked_at:new Date().toISOString(),one_read_plus_four_scenarios_ms:Math.round(performance.now()-start),scenarios:rows},null,2));
} catch { console.error('Bounded scoring verification failed; check public configuration, source expiry and current evidence versions. No fallback used.');process.exitCode=1; }
