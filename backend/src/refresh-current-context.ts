import { fetchCurrentFeeds, type LiveFeed } from './current-feeds.js';

type RefreshOptions = {
  tokenSha256: string;
  supabaseUrl: string;
  serviceRoleKey: string;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
};
type RefreshError = { source_id: string; stage: 'fetch' | 'publish'; error: string };

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

function databaseHeaders(key: string): Record<string, string> {
  if (typeof key !== 'string' || key.length > 8_192) throw new Error('Invalid server database credential.');
  const headers: Record<string, string> = {
    apikey: key, Accept: 'application/json', 'content-type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  };
  if (/^sb_secret_[A-Za-z0-9_-]+$/.test(key)) return headers;
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) throw new Error('Invalid server database credential.');
  try {
    const part = key.split('.')[1]!;
    const normalized = part.replaceAll('-', '+').replaceAll('_', '/');
    const claims = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')));
    if (claims.role !== 'service_role') throw new Error('Invalid role.');
  } catch { throw new Error('Invalid server database credential.'); }
  headers.Authorization = `Bearer ${key}`;
  return headers;
}

/** Authenticated, fixed-purpose endpoint. Request bodies never choose sources, tables or SQL. */
export function createRefreshHandler(options: RefreshOptions): (request: Request) => Promise<Response> {
  if (!/^[a-fA-F0-9]{64}$/.test(options.tokenSha256)) throw new Error('Invalid refresh token digest.');
  const expected = Uint8Array.from(options.tokenSha256.match(/.{2}/g)!, pair => Number.parseInt(pair, 16));
  const database = new URL(options.supabaseUrl);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(database.hostname);
  if ((database.protocol !== 'https:' && !(local && database.protocol === 'http:')) ||
      database.username || database.password || database.pathname !== '/' || database.search || database.hash) {
    throw new Error('Invalid Supabase project URL.');
  }
  const url = `${database.origin}/rest/v1/live_context?on_conflict=source_id`;
  const headers = databaseHeaders(options.serviceRoleKey);
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' }, { Allow: 'POST' });
    const token = request.headers.get('x-refresh-token') ?? '';
    if (!/^[a-fA-F0-9]{64}$/.test(token)) return json(401, { error: 'Unauthorized.' });
    const actual = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) mismatch |= expected[i]! ^ actual[i]!;
    if (mismatch !== 0) return json(401, { error: 'Unauthorized.' });

    let feeds: LiveFeed[], errors: RefreshError[];
    try {
      const result = await fetchCurrentFeeds({ fetch: fetcher, now: now() });
      feeds = result.feeds;
      errors = result.errors.map(error => ({
        source_id: error.source_id, stage: 'fetch',
        // Never echo provider content or arbitrary exception messages into a response.
        error: 'Provider request or freshness validation failed; previous snapshot retained.',
      }));
    } catch {
      return json(502, { status: 'error', updated: [], errors: [{ source_id: 'all', stage: 'fetch', error: 'Feed refresh failed; previous snapshots retained.' }] });
    }

    const updated: { source_id: string; record_count: number; valid_until: string }[] = [];
    for (const feed of feeds) {
      try {
        const response = await fetcher(url, {
          method: 'POST', headers, body: JSON.stringify(feed), signal: AbortSignal.timeout(15_000),
          // Do not forward the database credential through an unexpected redirect.
          redirect: 'error',
        });
        if (!response.ok) {
          errors.push({ source_id: feed.source_id, stage: 'publish', error: `Database write failed (HTTP ${response.status}).` });
        } else {
          updated.push({ source_id: feed.source_id, record_count: feed.record_count, valid_until: feed.valid_until });
        }
        try { await response.body?.cancel(); } catch { /* Cleanup does not change the confirmed HTTP result. */ }
      } catch {
        errors.push({ source_id: feed.source_id, stage: 'publish', error: 'Database write could not be confirmed; retry this source on the next refresh.' });
      }
    }
    const status = updated.length === 0 ? 'error' : errors.length ? 'partial' : 'ok';
    return json(status === 'error' ? 502 : status === 'partial' ? 207 : 200, { status, updated, errors });
  };
}
