import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config';

/**
 * Client for the live neighborhood reference layer documented in `docs/api.md`.
 *
 * Mirrors the contract of the backend's `createNeighborhoodClient`: fetch all 88
 * rows once, validate the shape, cache for 24 hours, coalesce concurrent
 * requests, and never serve an expired cache after an error.
 */

export interface NeighborhoodProfile {
  neighborhood_id: number;
  name: string;
  /** Annual household income in whole USD. Null when the City suppressed it. */
  median_household_income: number | null;
  median_home_value: number | null;
  /** Monthly gross rent in whole USD. */
  median_gross_rent: number | null;
  centroid_lat: number;
  centroid_lon: number;
  source_period_start: number;
  source_period_end: number;
  data_version: string;
  source_url: string;
  source_retrieved_at: string;
  quality_flags: string[];
}

export const EXPECTED_ROWS = 88;
const CACHE_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 1_000_000;

export class NeighborhoodDataError extends Error {
  constructor(
    message: string,
    /** `auth` and `request` are our bugs; `unavailable` is worth a retry. */
    readonly kind: 'auth' | 'request' | 'unavailable' | 'invalid',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'NeighborhoodDataError';
  }
}

function isProfile(row: unknown): row is NeighborhoodProfile {
  if (typeof row !== 'object' || row === null) return false;
  const r = row as Record<string, unknown>;
  const nullableInt = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v));
  return (
    typeof r.neighborhood_id === 'number' &&
    r.neighborhood_id >= 1 &&
    r.neighborhood_id <= EXPECTED_ROWS &&
    typeof r.name === 'string' &&
    r.name.length > 0 &&
    nullableInt(r.median_household_income) &&
    nullableInt(r.median_home_value) &&
    nullableInt(r.median_gross_rent) &&
    // Harris County bounds, matching the backend's zod schema.
    typeof r.centroid_lat === 'number' && r.centroid_lat >= 29 && r.centroid_lat <= 31 &&
    typeof r.centroid_lon === 'number' && r.centroid_lon >= -96.5 && r.centroid_lon <= -94.5 &&
    typeof r.data_version === 'string'
  );
}

/** Throws rather than returning a partial dataset — see `docs/api.md`. */
export function validateProfiles(input: unknown): NeighborhoodProfile[] {
  if (!Array.isArray(input)) {
    throw new NeighborhoodDataError('Neighborhood data was not a list.', 'invalid');
  }
  if (input.length !== EXPECTED_ROWS) {
    throw new NeighborhoodDataError(
      `Incomplete neighborhood dataset: ${input.length} of ${EXPECTED_ROWS} rows.`,
      'invalid',
    );
  }
  if (!input.every(isProfile)) {
    throw new NeighborhoodDataError('Neighborhood data did not match the expected shape.', 'invalid');
  }
  const rows = input as NeighborhoodProfile[];
  if (new Set(rows.map((r) => r.neighborhood_id)).size !== EXPECTED_ROWS) {
    throw new NeighborhoodDataError('Duplicate neighborhood IDs.', 'invalid');
  }
  if (new Set(rows.map((r) => r.data_version)).size !== 1) {
    throw new NeighborhoodDataError('Mixed dataset versions.', 'invalid');
  }
  return rows;
}

async function readBounded(response: Response): Promise<unknown> {
  const body = await response.text();
  if (body.length > MAX_BYTES) {
    throw new NeighborhoodDataError('Neighborhood response exceeds the size limit.', 'invalid');
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new NeighborhoodDataError('Neighborhood response was not valid JSON.', 'invalid');
  }
}

let cache: { rows: NeighborhoodProfile[]; at: number } | null = null;
let inFlight: Promise<NeighborhoodProfile[]> | null = null;

/** Test seam, also used to verify the render path before the key is available. */
export function primeCache(rows: NeighborhoodProfile[]) {
  cache = { rows: validateProfiles(rows), at: Date.now() };
}

export function clearCache() {
  cache = null;
  inFlight = null;
}

async function load(): Promise<NeighborhoodProfile[]> {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new NeighborhoodDataError(
      'Neighborhood data is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.',
      'auth',
    );
  }

  const url = new URL('/rest/v1/neighborhood_profiles', SUPABASE_URL);
  url.search = new URLSearchParams({
    select: '*',
    order: 'neighborhood_id.asc',
    limit: String(EXPECTED_ROWS),
  }).toString();

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new NeighborhoodDataError('Neighborhood data is temporarily unreachable.', 'unavailable');
  }

  if (!response.ok) {
    const { status } = response;
    if (status === 401 || status === 403) {
      throw new NeighborhoodDataError('Neighborhood data rejected the API key.', 'auth', status);
    }
    if (status === 400) {
      throw new NeighborhoodDataError('Neighborhood data request was invalid.', 'request', status);
    }
    throw new NeighborhoodDataError(
      `Neighborhood data is temporarily unavailable (HTTP ${status}).`,
      'unavailable',
      status,
    );
  }

  return validateProfiles(await readBounded(response));
}

/**
 * Cached read. Concurrent callers share one request; a failure does not fall
 * back to an expired cache, and does not poison the next attempt.
 */
export function fetchNeighborhoodProfiles(): Promise<NeighborhoodProfile[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return Promise.resolve(cache.rows);
  if (inFlight) return inFlight;

  inFlight = load()
    .then((rows) => {
      cache = { rows, at: Date.now() };
      return rows;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** ACS periods are uniform across the dataset, so the first row speaks for all. */
export function sourceLabel(rows: NeighborhoodProfile[]): string {
  const row = rows[0];
  if (!row) return 'City of Houston estimates';
  return `City of Houston estimates • ACS ${row.source_period_start}–${row.source_period_end}`;
}
