import assert from 'node:assert/strict';
import { createComparisonClient } from '../dist/comparison.js';
import { createEvidenceClient } from '../dist/evidence.js';
import { DEFAULT_WEIGHTS } from '../../shared/scoring.mjs';

// No candidate data, writes, upstream downloads, admin key or model API required.
try {
  const config = { url: process.env.SUPABASE_URL, publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY };
  let scoringRequests = 0;
  const client = createComparisonClient({ ...config, fetch: (...args) => { scoringRequests++; return fetch(...args); } });
  const baseline = { weights: { ...DEFAULT_WEIGHTS }, tenure: 'rent', mode: 'offer', office: 'ion', airport: 'nearest' };
  const alternative = { ...baseline, mode: 'remote', weights: { ...DEFAULT_WEIGHTS, afford: 10, fit: 10 } };
  const start = performance.now();
  const result = await client.compare({ baseline, alternative });
  const firstMs = performance.now() - start;
  assert.ok(result.baseline.ranked_count > 0 && result.alternative.ranked_count > 0, 'No rankable neighborhoods');
  const samples = [];
  for (let i = 0; i < 10; i++) {
    const tick = performance.now();
    const repeat = await client.compare({ baseline, alternative });
    samples.push(performance.now() - tick);
    assert.equal(repeat.snapshot_sha256, result.snapshot_sha256);
    assert.deepEqual(repeat.baseline, result.baseline);
  }
  assert.equal(scoringRequests, 1, 'Priority changes must reuse the snapshot');
  assert.equal(result.alternative.effective_weights.commute, 0);
  const ids = [...new Set([result.baseline.shortlist[0].neighborhoodId, result.alternative.shortlist[0].neighborhoodId])];
  const evidenceClient = createEvidenceClient(config);
  const sources = await Promise.all(ids.map(async neighborhood_id => {
    const response = await evidenceClient.getEvidence({ neighborhood_id });
    const categories = response.neighborhoods[0].categories;
    for (const c of Object.values(categories)) {
      assert.ok(result.evidence_versions.includes(c.evidence_version), 'Evidence changed during proof; rerun');
    }
    return { neighborhood_id, categories: Object.fromEntries(Object.entries(categories).map(([id, c]) => [id, {
      availability: c.availability, refresh_due_at: c.refresh_due_at, sources: c.sources, limitations: c.limitations,
    }])) };
  }));
  samples.sort((a, b) => a - b);
  console.log(JSON.stringify({ status: 'passed', checked_at: new Date().toISOString(),
    measurement_scope: 'One live public scoring read, 10 sequential cached scenario pairs, and source-evidence reads for the two winners. Not a load test or deployed-browser test.',
    performance: { first_pair_ms: Math.round(firstMs), cached_pair_p50_ms: +samples[4].toFixed(2), cached_pair_max_ms: +samples[9].toFixed(2), scoring_requests: scoringRequests },
    comparison: result, sources,
  }, null, 2));
} catch {
  console.error('Backend proof failed. Check public configuration, source freshness and evidence consistency; no synthetic fallback was used.');
  process.exitCode = 1;
}
