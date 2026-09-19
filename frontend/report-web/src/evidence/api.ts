import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config';
import { NeighborhoodDataError } from '../data/neighborhoodApi';
import { readBoundedJson } from '../data/scoringClient.mjs';
import { CATEGORY_IDS, type CategoryId, type EvidencePayload } from './types';

/**
 * Loader for `POST /rest/v1/rpc/get_neighborhood_evidence`.
 *
 * Follows the same conventions as `../data/neighborhoodApi.ts` — bounded
 * response, coalesced concurrent requests, no fallback to expired data — but
 * caches per neighborhood ID for at most an hour, as the handoff requires.
 * The RPC is a read despite being a POST.
 */

const CACHE_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 1_000_000;

/** Rejects secret keys and placeholders before any network request. */
export function publishableKeyLooksValid(key: string): boolean {
  return /^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(key);
}

function assertConfigured() {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new NeighborhoodDataError(
      'Evidence data is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.',
      'auth',
    );
  }
  if (!publishableKeyLooksValid(SUPABASE_PUBLISHABLE_KEY)) {
    throw new NeighborhoodDataError(
      'The configured Supabase key is not a modern publishable key.',
      'auth',
    );
  }
}

function isPayload(value: unknown): value is EvidencePayload {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    Array.isArray(p.category_definitions) &&
    Array.isArray(p.neighborhoods) &&
    typeof p.safety === 'object' &&
    p.safety !== null
  );
}

/**
 * The RPC answers for one ID at a time here, so a payload describing a
 * different neighborhood means the response was mismatched — refuse it rather
 * than render another area's facts under this one's name.
 */
export function validateEvidence(input: unknown, expectedId: number): EvidencePayload {
  if (!isPayload(input)) {
    throw new NeighborhoodDataError('Evidence response did not match the expected shape.', 'invalid');
  }
  const first = input.neighborhoods[0];
  if (!first) {
    throw new NeighborhoodDataError(`No evidence returned for neighborhood ${expectedId}.`, 'invalid');
  }
  if (first.neighborhood_id !== expectedId) {
    throw new NeighborhoodDataError(
      `Evidence response was for neighborhood ${first.neighborhood_id}, not ${expectedId}.`,
      'invalid',
    );
  }
  const known = new Set<string>(CATEGORY_IDS);
  for (const id of Object.keys(first.categories ?? {})) {
    if (!known.has(id)) delete (first.categories as Record<string, unknown>)[id];
  }
  return input;
}

const cache = new Map<number, { payload: EvidencePayload; at: number }>();
const inFlight = new Map<number, Promise<EvidencePayload>>();

export function clearEvidenceCache() {
  cache.clear();
  inFlight.clear();
}

/** Test seam; also used to render the UI before a key is configured. */
export function primeEvidence(id: number, payload: EvidencePayload) {
  cache.set(id, { payload: validateEvidence(payload, id), at: Date.now() });
}

async function load(id: number): Promise<EvidencePayload> {
  assertConfigured();

  const url = new URL('/rest/v1/rpc/get_neighborhood_evidence', SUPABASE_URL);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_neighborhood_id: id }),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new NeighborhoodDataError('Evidence data is temporarily unreachable.', 'unavailable');
  }

  if (!response.ok) {
    const { status } = response;
    if (status === 401 || status === 403) {
      throw new NeighborhoodDataError('Evidence data rejected the API key.', 'auth', status);
    }
    if (status === 400 || status === 404) {
      throw new NeighborhoodDataError('Evidence request was invalid.', 'request', status);
    }
    throw new NeighborhoodDataError(
      `Evidence data is temporarily unavailable (HTTP ${status}).`,
      'unavailable',
      status,
    );
  }

  let parsed: unknown;
  try {
    parsed = await readBoundedJson(response, MAX_BYTES);
  } catch {
    throw new NeighborhoodDataError('Evidence response was invalid or exceeded the size limit.', 'invalid');
  }

  return validateEvidence(parsed, id);
}

export function fetchEvidence(id: number): Promise<EvidencePayload> {
  const hit = cache.get(id);
  const deadline = hit ? nextExpiry(hit.payload) : null;
  if (hit && Date.now() - hit.at < CACHE_MS && (deadline === null || Date.now() < deadline)) return Promise.resolve(hit.payload);

  const pending = inFlight.get(id);
  if (pending) return pending;

  const request = load(id)
    .then((payload) => {
      cache.set(id, { payload, at: Date.now() });
      return payload;
    })
    .finally(() => {
      inFlight.delete(id);
    });

  inFlight.set(id, request);
  return request;
}

/** The earliest `refresh_due_at` across displayable categories, for a timer. */
export function nextExpiry(payload: EvidencePayload): number | null {
  const categories = payload.neighborhoods[0]?.categories ?? {};
  const times = Object.values(categories)
    .map((c) => (c?.refresh_due_at ? Date.parse(c.refresh_due_at) : NaN))
    .filter((t) => Number.isFinite(t)) as number[];
  return times.length ? Math.min(...times) : null;
}

export type { CategoryId };
