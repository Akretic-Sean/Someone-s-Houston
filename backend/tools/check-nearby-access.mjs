import assert from 'node:assert/strict';
import { loadConnectionConfig } from './check-frontend-connection.mjs';
import { createScoringClient } from '../../frontend/report-web/src/data/scoringClient.mjs';
import { scoreNeighborhoodsWithEstimates } from '../../shared/scoring-estimates.mjs';
import { DEFAULT_WEIGHTS, ACCESS_MODEL_VERSION } from '../../shared/scoring.mjs';

const config = await loadConnectionConfig({ envFile: process.argv[2] });
const client = createScoringClient({ url: config.url, key: config.publishableKey });
const payload = await client.load();
assert.equal(payload.base.model_version, ACCESS_MODEL_VERSION);
const result = scoreNeighborhoodsWithEstimates(payload, {
  weights: DEFAULT_WEIGHTS, tenure: 'rent', mode: 'offer', office: 'ion', airport: 'nearest',
});
assert.equal(result.results.length, 88);
assert.equal(result.ranked.length, 88);
const eastwood = result.results.find(row => row.neighborhoodId === 64);
assert.ok(eastwood.categories.amen.nearbyAccess.facilities.libraries.count > 3);
assert.ok(eastwood.categories.health.nearbyAccess.facilities.hospitals.count > 3);
console.log(JSON.stringify({ model: result.modelVersion, ranked: result.ranked.length,
  bytes: Buffer.byteLength(JSON.stringify(payload)), eastwood: {
    amenities: eastwood.categories.amen.nearbyAccess,
    healthcare: eastwood.categories.health.nearbyAccess,
    amenitiesScore: eastwood.categories.amen.score, healthcareScore: eastwood.categories.health.score,
  }, topThree: result.ranked.slice(0, 3).map(row => ({ id: row.neighborhoodId, name: row.name, score: row.totalScore })),
}, null, 2));
