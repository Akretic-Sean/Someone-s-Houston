import type { CategoryId, ScoringOptions, ScoringResult, Weights } from './scoring.mjs';
export interface CommonCoverageResult {
  policyVersion: 'common-coverage-v1';
  label: string;
  evaluatedAt: string;
  requestedWeights: Weights;
  requestedEffectiveWeights: Weights;
  retainedWeightFraction: number;
  omittedCategories: Array<{ id: CategoryId; label: string; requestedWeight: number;
    affectedNeighborhoods: Array<{ neighborhoodId: number; name: string; reason: string | null }> }>;
  includedCategories: CategoryId[];
  notice: string;
  requested: ScoringResult;
  comparison: ScoringResult;
}
export function scoreAllNeighborhoods(payload: unknown, options: ScoringOptions, now?: number): CommonCoverageResult;
