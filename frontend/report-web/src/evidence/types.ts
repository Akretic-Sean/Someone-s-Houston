/**
 * Types for the category evidence RPC (`get_neighborhood_evidence`).
 *
 * Deliberately separate from the mock `Neighborhood` / `ResolvedNeighborhood`
 * in `../types.ts`: those require non-null scores, safety tiers and commute
 * text that this RPC cannot supply, and casting one to the other would hide
 * exactly the gap the handoff asks us to surface. See
 * `docs/frontend-backend-handoff.md`.
 */

export const CATEGORY_IDS = [
  'afford',
  'commute',
  'flood',
  'amen',
  'fit',
  'food',
  'air',
  'health',
] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];

/** Only `partial` and `reference_snapshot` may be displayed. */
export type Availability =
  | 'partial'
  | 'reference_snapshot'
  | 'needs_refresh'
  | 'unavailable'
  | string;

export interface EvidenceSource {
  source_id: string;
  source_url?: string | null;
  source_period?: string | null;
  source_checked_at?: string | null;
  data_version?: string | null;
}

export interface Destination {
  id: string;
  kind?: string | null;
  label: string;
  address?: string | null;
  note?: string | null;
  /** GeoJSON order: [longitude, latitude]. */
  coordinates?: [number, number] | null;
  straight_line_meters?: number | null;
  /** Null until a routing service exists. Never derive it from distance. */
  drive_time_minutes?: number | null;
}

export interface NearestPlace {
  place_id: string;
  name: string;
  address?: string | null;
  latitude: number;
  longitude: number;
  straight_line_meters?: number | null;
  inside_neighborhood?: boolean | null;
  source_id?: string | null;
  location_method?: string | null;
}

export interface Inventory {
  record_count_in_neighborhood: number | null;
  nearest_to_reference_point?: NearestPlace[] | null;
  distance_method?: string | null;
}

export interface HousingStock {
  total_housing_units?: number | null;
  structure_counts?: Record<string, number> | null;
  bedroom_counts?: Record<string, number> | null;
  year_built_counts?: Record<string, number> | null;
  shares_pct?: Record<string, number> | null;
}

export interface CategoryFacts {
  median_gross_rent_monthly_usd?: number | null;
  median_home_value_usd?: number | null;
  housing_stock?: HousingStock | null;
  destinations?: Destination[] | null;
  route_status?: string | null;
  inventories?: Record<string, Inventory> | null;
  /** Flood carries its own inner availability, checked separately. */
  availability?: string | null;
  sfha_area_pct?: number | null;
  annual_0_2_pct_area_pct?: number | null;
  floodway_area_pct?: number | null;
  mapped_zone_coverage_pct?: number | null;
  panel_effective_date_min?: string | null;
  panel_effective_date_max?: string | null;
  flags?: string[] | null;
  definitions?: Record<string, string> | null;
  [key: string]: unknown;
}

export interface Category {
  availability: Availability;
  facts: CategoryFacts | null;
  sources?: EvidenceSource[] | null;
  missing_inputs?: string[] | null;
  limitations?: string[] | null;
  prepared_at?: string | null;
  /** Must match the compact scoring publication before joining detail facts. */
  evidence_version?: string | null;
  /** Past this, the category is stale and must not be displayed. */
  refresh_due_at?: string | null;
  /** Always null today; `score_status` is `not_implemented`. */
  score: number | null;
  score_status?: string | null;
}

export interface EvidenceNeighborhood {
  neighborhood_id: number;
  name: string;
  reference_point?: unknown;
  categories: Partial<Record<CategoryId, Category>>;
}

export interface CategoryDefinition {
  id: CategoryId;
  label: string;
  default_weight: number;
}

export interface SafetyBlock {
  weighted: boolean;
  /** Null: no validated dataset or tier methodology exists. */
  tier: string | null;
  availability: string;
  reason?: string | null;
}

export interface EvidencePayload {
  profile_id?: string | null;
  weight_total?: number | null;
  evaluated_at?: string | null;
  category_definitions: CategoryDefinition[];
  safety: SafetyBlock;
  neighborhoods: EvidenceNeighborhood[];
  interpretation?: string | null;
}

/** Why a category is not being shown, for the UI to say so plainly. */
export type WithheldReason =
  | 'unavailable'
  | 'needs_refresh'
  | 'expired'
  | 'no_facts';

export interface CategoryView {
  id: CategoryId;
  label: string;
  defaultWeight: number;
  category: Category | null;
  /** Null when displayable; otherwise why it is withheld. */
  withheld: WithheldReason | null;
}
