import { CATEGORY_IDS, ScoringValidationError, scoreNeighborhoods } from './scoring.mjs';

/**
 * Explicit opt-in comparison on common, current measurements. This does not
 * fill data gaps or change the strict model. A category missing anywhere is
 * removed for EVERY neighborhood, and requested weights remain separate.
 */
export function scoreAllNeighborhoods(payload, options, now = Date.now()) {
  const requested = scoreNeighborhoods(payload, options, now);
  const omittedCategories = CATEGORY_IDS.filter(id => requested.effectiveWeights[id] > 0 && requested.results.some(r => r.categories[id].score === null))
    .map(id => ({
      id, label: requested.results[0].categories[id].label,
      requestedWeight: requested.effectiveWeights[id],
      affectedNeighborhoods: requested.results.filter(r => r.categories[id].score === null).map(r => ({
        neighborhoodId: r.neighborhoodId, name: r.name, reason: r.categories[id].reason,
      })),
    }));
  const omitted = new Set(omittedCategories.map(c => c.id));
  const weights = Object.fromEntries(CATEGORY_IDS.map(id => [id, omitted.has(id) ? 0 : requested.effectiveWeights[id]]));
  const requestedTotal = Object.values(requested.effectiveWeights).reduce((a, b) => a + b, 0);
  const retainedTotal = Object.values(weights).reduce((a, b) => a + b, 0);
  if (retainedTotal === 0) throw new ScoringValidationError('NO_COMMON_CATEGORIES',
    'None of the selected priorities has complete current coverage across all 88 neighborhoods. Select another priority or use the full-priority view.');
  const comparison = scoreNeighborhoods(payload, { ...options, weights }, now);
  // Never silently return an incomplete cohort or relax per-neighborhood rules.
  if (comparison.ranked.length !== 88) throw new ScoringValidationError('INCOMPLETE_COMMON_COHORT', 'The all-neighborhood comparison is incomplete. Refresh the data.');
  return {
    policyVersion: 'common-coverage-v1',
    label: 'All 88 — shared-data comparison',
    evaluatedAt: comparison.evaluatedAt,
    requestedWeights: { ...options.weights },
    requestedEffectiveWeights: { ...requested.effectiveWeights },
    retainedWeightFraction: retainedTotal / requestedTotal,
    omittedCategories,
    includedCategories: CATEGORY_IDS.filter(id => weights[id] > 0),
    notice: omittedCategories.length
      ? `This comparison excludes ${omittedCategories.map(c => c.label).join(', ')} for all 88 neighborhoods because coverage is incomplete. Scores represent only the remaining priorities; missing facts remain unknown.`
      : 'All selected priorities have complete current coverage across all 88 neighborhoods.',
    requested,
    comparison,
  };
}
