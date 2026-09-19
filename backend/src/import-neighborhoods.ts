import { createHash } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { SOURCE_URL, readBoundedJson, supabaseBaseUrl, validateProfiles, type NeighborhoodProfile } from './neighborhoods.js';

const referenceSchema = z.object({
  source_period_start: z.literal(2020), source_period_end: z.literal(2024),
  neighborhoods: z.array(z.object({
    neighborhood_id: z.number().int().min(1).max(88), name: z.string(),
    median_household_income: z.number().int().positive().nullable(),
    median_home_value: z.number().int().positive().nullable(),
    median_gross_rent: z.number().int().positive().nullable(),
  })).length(88),
});
const estimate = z.number().finite().positive().nullable();
const arcgisSchema = z.object({
  exceededTransferLimit: z.boolean().optional(),
  spatialReference: z.object({ wkid: z.literal(4326) }),
  features: z.array(z.object({
    attributes: z.object({ POLYID: z.number().int().min(1).max(88), SNBNAME: z.string(), M_HHI: estimate, M_HV: estimate, M_GR: estimate }),
    centroid: z.object({ x: z.number().min(-96.5).max(-94.5), y: z.number().min(29).max(31) }),
  })).length(88),
});

export function prepareProfiles(raw: unknown, referenceInput: unknown, retrievedAt: string): NeighborhoodProfile[] {
  const reference = referenceSchema.parse(referenceInput);
  const source = arcgisSchema.parse(raw);
  if (source.exceededTransferLimit) throw new Error('ArcGIS response is incomplete.');
  if (new Set(reference.neighborhoods.map(r => r.neighborhood_id)).size !== 88) throw new Error('Duplicate reference IDs.');
  const round = (value: number | null) => value === null ? null : Math.round(value);
  const rows = source.features.map(({ attributes: a, centroid }) => {
    const referenceRow = reference.neighborhoods.find(r => r.neighborhood_id === a.POLYID)!;
    const metrics = {
      median_household_income: round(a.M_HHI), median_home_value: round(a.M_HV), median_gross_rent: round(a.M_GR),
    };
    if (referenceRow.name !== a.SNBNAME || Object.entries(metrics).some(([key, value]) => referenceRow[key as keyof typeof metrics] !== value)) {
      throw new Error(`Neighborhood ${a.POLYID} differs from the verified 2024 tables. Review the new release before publishing.`);
    }
    return {
      neighborhood_id: a.POLYID, name: a.SNBNAME, ...metrics,
      centroid_lat: Number(centroid.y.toFixed(6)), centroid_lon: Number(centroid.x.toFixed(6)),
      source_period_start: reference.source_period_start, source_period_end: reference.source_period_end,
      source_url: SOURCE_URL,
      quality_flags: [
        ...(metrics.median_household_income === null ? ['income_unavailable' as const] : []),
        ...(metrics.median_home_value === null ? ['home_value_unavailable' as const] : []),
        ...(metrics.median_gross_rent === null ? ['rent_unavailable' as const] : []),
      ],
    };
  }).sort((a, b) => a.neighborhood_id - b.neighborhood_id);
  const hash = createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16);
  return validateProfiles(rows.map(r => ({ ...r, data_version: `coh-sn-2024-${hash}`, source_retrieved_at: retrievedAt })));
}

export async function fetchSource(fetcher = globalThis.fetch): Promise<unknown> {
  const params = new URLSearchParams({ f: 'json', where: '1=1', outFields: 'POLYID,SNBNAME,M_HHI,M_HV,M_GR', outSR: '4326', returnGeometry: 'false', returnCentroid: 'true', orderByFields: 'POLYID', resultRecordCount: '100' });
  // One bounded request. A failed refresh leaves the last validated snapshot/database intact.
  return readBoundedJson(await fetcher(`${SOURCE_URL}/query?${params}`, { signal: AbortSignal.timeout(30_000) }));
}

export async function publishProfiles(rowsInput: unknown, options: { url: string; secretKey: string; fetch?: typeof globalThis.fetch }) {
  const rows = validateProfiles(rowsInput);
  const base = supabaseBaseUrl(options.url);
  if (!options.secretKey.startsWith('sb_secret_')) throw new Error('Publishing requires a server-only sb_secret_ key.');
  const fetcher = options.fetch ?? globalThis.fetch;
  const headers = { apikey: options.secretKey, 'Content-Type': 'application/json' };
  const current = await readBoundedJson(await fetcher(`${base}/rest/v1/neighborhood_profiles?select=neighborhood_id,data_version&limit=89`, { headers, signal: AbortSignal.timeout(15_000) }));
  const currentRows = z.array(z.object({ neighborhood_id: z.number().int(), data_version: z.string() })).parse(current);
  if (currentRows.length === 88 && new Set(currentRows.map(r => r.neighborhood_id)).size === 88 &&
      currentRows.every(r => rows.some(next => next.neighborhood_id === r.neighborhood_id && next.data_version === r.data_version))) {
    return { status: 'unchanged', rows: 88, data_version: rows[0]!.data_version };
  }
  // A single PostgREST bulk upsert is one database transaction: all 88 rows or none.
  const response = await fetcher(`${base}/rest/v1/neighborhood_profiles?on_conflict=neighborhood_id`, {
    method: 'POST', headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows), signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Publish failed (HTTP ${response.status}); inspect server logs without sharing credentials.`);
  return { status: 'published', rows: 88, data_version: rows[0]!.data_version };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--publish')) throw new Error('Usage: import-neighborhoods.js [--publish]');
  const reference = JSON.parse(await readFile(new URL('../data/reference/super-neighborhoods-2024.json', import.meta.url), 'utf8'));
  const rows = prepareProfiles(await fetchSource(), reference, new Date().toISOString());
  const destination = new URL('../data/super-neighborhoods.json', import.meta.url);
  const content = JSON.stringify(rows, null, 2) + '\n';
  let changed = true;
  try {
    const previous = validateProfiles(JSON.parse(await readFile(destination, 'utf8')));
    changed = previous[0]!.data_version !== rows[0]!.data_version;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (changed) {
    const temporary = new URL('../data/super-neighborhoods.json.tmp', import.meta.url);
    await writeFile(temporary, content);
    await rename(temporary, destination);
  }
  console.log(JSON.stringify({ status: changed ? 'prepared' : 'unchanged', rows: rows.length, json_bytes: Buffer.byteLength(JSON.stringify(rows)), data_version: rows[0]!.data_version }));
  if (args.includes('--publish')) console.log(JSON.stringify(await publishProfiles(rows, { url: process.env.SUPABASE_URL ?? '', secretKey: process.env.SUPABASE_SECRET_KEY ?? '' })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'Import failed.'); process.exitCode = 1; });
}
