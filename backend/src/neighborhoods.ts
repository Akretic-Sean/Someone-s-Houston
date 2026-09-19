import { z } from 'zod';

export const SOURCE_URL = 'https://services.arcgis.com/NummVBqZSIJKUeVR/arcgis/rest/services/Super_Neighborhoods_Demographics/FeatureServer/2';
export const PROFILE_COLUMNS = 'neighborhood_id,name,median_household_income,median_home_value,median_gross_rent,centroid_lat,centroid_lon,source_period_start,source_period_end,data_version,source_url,source_retrieved_at,quality_flags';

export const profileSchema = z.object({
  neighborhood_id: z.number().int().min(1).max(88),
  name: z.string().min(1).max(120),
  median_household_income: z.number().int().positive().nullable(),
  median_home_value: z.number().int().positive().nullable(),
  median_gross_rent: z.number().int().positive().nullable(),
  centroid_lat: z.number().min(29).max(31),
  centroid_lon: z.number().min(-96.5).max(-94.5),
  source_period_start: z.number().int().min(2000).max(2100),
  source_period_end: z.number().int().min(2000).max(2100),
  data_version: z.string().regex(/^coh-sn-\d{4}-[a-f0-9]{16}$/),
  source_url: z.literal(SOURCE_URL),
  source_retrieved_at: z.iso.datetime({ offset: true }),
  quality_flags: z.array(z.enum(['income_unavailable', 'home_value_unavailable', 'rent_unavailable'])),
});
export type NeighborhoodProfile = z.infer<typeof profileSchema>;

export function validateProfiles(input: unknown): NeighborhoodProfile[] {
  const rows = z.array(profileSchema).length(88).parse(input);
  if (new Set(rows.map(r => r.neighborhood_id)).size !== 88) throw new Error('Duplicate neighborhood IDs.');
  if (new Set(rows.map(r => r.data_version)).size !== 1) throw new Error('Mixed dataset versions.');
  if (new Set(rows.map(r => `${r.source_period_start}-${r.source_period_end}`)).size !== 1 ||
      rows.some(r => r.source_period_end - r.source_period_start !== 4)) {
    throw new Error('Invalid or mixed ACS five-year periods.');
  }
  return rows;
}

export async function readBoundedJson(response: Response, maxBytes = 1_000_000): Promise<unknown> {
  if (!response.ok) throw new Error(`Data request failed (HTTP ${response.status}).`);
  if (!response.body) throw new Error('Data response has no body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw new Error('Data response exceeds size limit.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function supabaseBaseUrl(value: string): string {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use the HTTPS Supabase project URL without a path.');
  }
  return url.origin;
}

/** Create once per app/process, then reuse. Reads all 88 rows in one request. */
export function createNeighborhoodClient(options: {
  url: string;
  publishableKey: string;
  cacheMs?: number;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}) {
  const baseUrl = supabaseBaseUrl(options.url);
  if (!options.publishableKey.startsWith('sb_publishable_')) {
    throw new Error('A modern Supabase publishable key is required; do not supply an admin key.');
  }
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const cacheMs = options.cacheMs ?? 24 * 60 * 60 * 1000;
  if (!Number.isFinite(cacheMs) || cacheMs < 0 || cacheMs > 86_400_000) throw new Error('Cache must be 0-24 hours.');
  let cached: NeighborhoodProfile[] | undefined;
  let expires = 0;
  let inflight: Promise<NeighborhoodProfile[]> | undefined;

  return {
    async list(): Promise<NeighborhoodProfile[]> {
      if (cached && now() < expires) return structuredClone(cached);
      if (!inflight) {
        inflight = (async () => {
          const query = new URLSearchParams({ select: PROFILE_COLUMNS, order: 'neighborhood_id.asc', limit: '89' });
          const response = await fetcher(`${baseUrl}/rest/v1/neighborhood_profiles?${query}`, {
            headers: { apikey: options.publishableKey, Accept: 'application/json' },
            signal: AbortSignal.timeout(15_000),
          });
          const rows = validateProfiles(await readBoundedJson(response));
          cached = rows;
          expires = now() + cacheMs;
          return rows;
        })().finally(() => { inflight = undefined; });
      }
      return structuredClone(await inflight);
    },
  };
}

export const filterSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  max_median_rent: z.number().positive().max(100_000).optional(),
  max_median_home_value: z.number().positive().max(100_000_000).optional(),
  limit: z.number().int().min(1).max(88).default(10),
}).strict();

/** Filters estimates, not current listings or a complete affordability score. */
export function filterNeighborhoods(rows: NeighborhoodProfile[], input: unknown) {
  const args = filterSchema.parse(input);
  const matches = rows.filter(r =>
    (!args.name || r.name.toLowerCase().includes(args.name.toLowerCase())) &&
    (args.max_median_rent === undefined || (r.median_gross_rent !== null && r.median_gross_rent <= args.max_median_rent)) &&
    (args.max_median_home_value === undefined || (r.median_home_value !== null && r.median_home_value <= args.max_median_home_value)));
  return { total_matches: matches.length, neighborhoods: matches.slice(0, args.limit) };
}
