import type { ScoringOptions, ScoringResult, ScoredNeighborhood, ScoringPayload } from './scoring.d.mts';
export interface EstimateInput {
  neighborhood_id: number; category_id: 'afford'|'flood'; metric: 'rent_usd'|'sfha_area_pct';
  lower_bound: number; upper_bound: number; ranking_value: number; method: 'conservative_upper_bound';
  source_url: string; source_period: string; source_checked_at: string; refresh_due_at: string;
  source_sha256: string; boundary_version: string; base_evidence_version: string;
  audit: Record<string, unknown>; limitation: string;
}
export interface BoundedNeighborhood extends ScoredNeighborhood {
  estimateInputsUsed: EstimateInput[];
  dataQuality: 'includes_conservative_bound'|'reference_measurements';
}
export interface BoundedScoringResult extends ScoringResult {
  policyVersion: 'source-bounded-v1'; notice: string; estimateInputsUsed: EstimateInput[];
  results: BoundedNeighborhood[]; ranked: BoundedNeighborhood[]; unranked: BoundedNeighborhood[];
}
export const ESTIMATE_POLICY: 'source-bounded-v1';
export function scoreNeighborhoodsWithEstimates(envelope: unknown, options: ScoringOptions, now?: number): BoundedScoringResult;

export interface BoundedScoringPayload {
  schema_version: 1; policy_version: 'source-bounded-v1'; base: ScoringPayload; estimates: EstimateInput[];
}
export function validateBoundedScoringPayload(envelope: unknown, now?: number): BoundedScoringPayload;
