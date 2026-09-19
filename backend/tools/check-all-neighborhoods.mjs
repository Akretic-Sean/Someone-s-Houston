import assert from 'node:assert/strict';
import { readBoundedJson, supabaseBaseUrl } from '../dist/neighborhoods.js';
import { DEFAULT_WEIGHTS } from '../../shared/scoring.mjs';
import { scoreAllNeighborhoods } from '../../shared/scoring-coverage.mjs';

try {
  const base = supabaseBaseUrl(process.env.SUPABASE_URL);
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key ?? '')) throw new Error('Public configuration required');
  const start = performance.now();
  const payload = await readBoundedJson(await fetch(`${base}/rest/v1/rpc/get_neighborhood_scoring_data`, {
    method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: '{}',
    redirect: 'error', signal: AbortSignal.timeout(15_000),
  }), 250_000);
  const fetched = performance.now();
  const scenarios = [];
  for (const tenure of ['rent', 'buy']) for (const mode of ['offer', 'remote']) {
    const result = scoreAllNeighborhoods(payload, { tenure, mode, office: 'ion', airport: 'nearest', weights: { ...DEFAULT_WEIGHTS } });
    assert.equal(result.comparison.ranked.length, 88);
    assert.equal(new Set(result.comparison.ranked.map(r => r.neighborhoodId)).size, 88);
    scenarios.push({ tenure, mode, requested_ranked: result.requested.ranked.length, common_ranked: result.comparison.ranked.length,
      retained_weight_fraction: result.retainedWeightFraction, omitted_categories: result.omittedCategories, notice: result.notice });
  }
  console.log(JSON.stringify({ status: 'passed', checked_at: new Date().toISOString(), scoring_requests: 1,
    fetch_ms: Math.round(fetched - start), four_scenarios_ms: Math.round(performance.now() - fetched), scenarios }, null, 2));
} catch {
  console.error('All-neighborhood verification failed. Check configuration, complete cohort and current source coverage. No fallback data was used.');
  process.exitCode = 1;
}
