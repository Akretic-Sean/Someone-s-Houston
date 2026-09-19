import { validateBoundedScoringPayload } from '../../../../shared/scoring-estimates.mjs';

const CACHE_MS = 60 * 60 * 1000;
const MAX_BYTES = 1_000_000;

/** Streaming bound: never buffer a server's unbounded error or payload. */
export async function readBoundedJson(response, maxBytes = MAX_BYTES) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('Scoring response exceeds the size limit.');
  if (!response.body) throw new Error('Scoring response was empty.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error('Scoring response exceeds the size limit.');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    reader.releaseLock();
  }
}

export function nextScoringDeadline(payload, now = Date.now()) {
  const dates = payload.base.neighborhoods.flatMap(row => Object.values(row.categories)
    .map(category => Date.parse(category.refresh_due_at ?? '')))
    .concat(payload.estimates.map(estimate => Date.parse(estimate.refresh_due_at)))
    .filter(value => Number.isFinite(value) && value > now);
  return dates.length ? Math.min(...dates) : null;
}

/** Read-only browser client; one shared response, no candidate data sent. */
export function createScoringClient({ url, key, fetchImpl = fetch, now = Date.now }) {
  let cache = null;
  let inFlight = null;
  function assertConfiguration() {
    if (url.replace(/\/$/, '') !== 'https://hknzivrgihnqzvsafkkr.supabase.co') {
      throw new Error('Set VITE_SUPABASE_URL to the Houston Supabase project URL.');
    }
    if (!/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(key)) {
      throw new Error('Set VITE_SUPABASE_PUBLISHABLE_KEY to the project’s publishable key.');
    }
  }
  async function load() {
    assertConfiguration();
    if (cache && now() < cache.expiresAt) return structuredClone(cache.payload);
    if (inFlight) return structuredClone(await inFlight);
    inFlight = (async () => {
      const response = await fetchImpl(`${url.replace(/\/$/, '')}/rest/v1/rpc/get_neighborhood_scoring_data_with_estimates`, {
        method: 'POST',
        headers: { apikey: key, 'Content-Type': 'application/json' },
        body: '{}',
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        throw new Error(response.status === 401 || response.status === 403
          ? 'Supabase rejected the publishable key. Check the frontend configuration.'
          : `Scoring data is unavailable (HTTP ${response.status}). Please retry.`);
      }
      const payload = await readBoundedJson(response);
      const at = now();
      validateBoundedScoringPayload(payload, at);
      cache = { payload, expiresAt: Math.min(at + CACHE_MS, nextScoringDeadline(payload, at) ?? Infinity) };
      return payload;
    })().catch(error => {
      cache = null;
      throw error;
    }).finally(() => { inFlight = null; });
    return structuredClone(await inFlight);
  }
  return { load, nextRefreshAt() { return cache?.expiresAt ?? null; }, invalidate() { cache = null; } };
}
