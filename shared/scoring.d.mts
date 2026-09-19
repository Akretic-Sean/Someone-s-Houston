export type CategoryId = 'afford' | 'commute' | 'flood' | 'amen' | 'fit' | 'food' | 'air' | 'health';
export type OfficeId = 'ion' | 'downtown' | 'energy' | 'tmc' | 'nasa';
export type AirportSelection = 'iah' | 'hou' | 'nearest';
export type Weights = Record<CategoryId, number>;
export type Availability = 'reference_snapshot' | 'partial' | 'unavailable' | 'needs_refresh';
export interface MetricFields {
  afford: { rent_usd: number | null; home_value_usd: number | null };
  commute: Record<OfficeId, number | null>;
  flood: { sfha_area_pct: number | null };
  amen: { libraries: number | null; museums: number | null; community_centers: number | null; multi_service_centers: number | null };
  fit: { parks: number | null; community_centers: number | null };
  food: { grocery_stores: number | null };
  air: { iah: number | null; hou: number | null };
  health: { hospitals: number | null; health_facilities: number | null; multi_service_centers: number | null };
}
export interface ScoringCategory<T> {
  availability: Availability;
  refresh_due_at: string | null;
  evidence_version: string | null;
  metrics: T;
}
export interface ReferencePoint { latitude: number; longitude: number }
export interface ScoringNeighborhood {
  neighborhood_id: number;
  name: string;
  reference_point: ReferencePoint;
  categories: { [K in CategoryId]: ScoringCategory<MetricFields[K]> };
}
export interface ScoringPayload {
  schema_version: 1;
  model_version: 'houston-proximity-v1';
  evaluated_at: string;
  category_definitions: Array<{ id: CategoryId; label: string; default_weight: number }>;
  neighborhoods: ScoringNeighborhood[];
}
export interface ScoringOptions {
  weights: Weights;
  tenure: 'rent' | 'buy';
  mode: 'offer' | 'remote';
  office: OfficeId;
  airport: AirportSelection;
}
export interface ScoredCategory {
  score: number | null;
  weight: number;
  normalizedWeight: number;
  contribution: number | null;
  metrics: Record<string, number | null>;
  reason: string | null;
  label: string;
  measurement: string;
}
export interface ScoredNeighborhood {
  neighborhoodId: number;
  name: string;
  referencePoint: ReferencePoint;
  rank: number | null;
  totalScore: number | null;
  categories: Record<CategoryId, ScoredCategory>;
  missingCategories: CategoryId[];
  explanations: string[];
}
export interface ScoringResult {
  modelVersion: 'houston-proximity-v1';
  evaluatedAt: string;
  effectiveWeights: Weights;
  normalizedWeights: Weights;
  ranked: ScoredNeighborhood[];
  unranked: ScoredNeighborhood[];
  results: ScoredNeighborhood[];
}
export const MODEL_VERSION: 'houston-proximity-v1';
export const CATEGORY_IDS: readonly CategoryId[];
export const DEFAULT_WEIGHTS: Readonly<Weights>;
export class ScoringValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string);
}
export function validateScoringPayload(payload: unknown): ScoringPayload;
export function scoreNeighborhoods(payload: unknown, options: ScoringOptions, now?: number): ScoringResult;
