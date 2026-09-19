import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { readBoundedJson, supabaseBaseUrl } from './neighborhoods.js';

// Refreshes only the additive context tables, never the weighted evidence model.
export async function publishRelocationContext(input: unknown, options: { url: string; secretKey: string; fetch?: typeof fetch }) {
  const base = supabaseBaseUrl(options.url);
  if (!/^sb_secret_[A-Za-z0-9_-]+$/.test(options.secretKey)) throw new Error('A server-only publisher key is required');
  const data = input as { schema_version?: number; snapshots?: { source: { source_id: string }; rows: { neighborhood_id: number }[] }[] };
  if (data?.schema_version !== 1 || !Array.isArray(data.snapshots) || data.snapshots.length !== 2 ||
      new Set(data.snapshots.map(s => s.source?.source_id)).size !== 2) throw new Error('Invalid relocation publication');
  const results = [];
  for (const snapshot of data.snapshots) {
    if (!['metro_gtfs','hpd_crime_2024'].includes(snapshot.source.source_id) || snapshot.rows?.length !== 88 ||
        new Set(snapshot.rows.map(r => r.neighborhood_id)).size !== 88 || snapshot.rows.some(r => !Number.isInteger(r.neighborhood_id) || r.neighborhood_id<1 || r.neighborhood_id>88)) throw new Error('Incomplete context cohort');
    const body = JSON.stringify({ p_source: snapshot.source, p_rows: snapshot.rows });
    if (Buffer.byteLength(body)>2_000_000) throw new Error('Oversized publication');
    const response = await (options.fetch ?? fetch)(`${base}/rest/v1/rpc/publish_neighborhood_supplement`, {
      method: 'POST', headers: { apikey: options.secretKey, 'Content-Type':'application/json' },
      body, signal: AbortSignal.timeout(30_000), redirect:'error',
    });
    results.push(await readBoundedJson(response, 10000));
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const data = JSON.parse(await readFile(new URL('../data/neighborhood-relocation-context.json', import.meta.url), 'utf8'));
    console.log(JSON.stringify(await publishRelocationContext(data, { url: process.env.SUPABASE_URL ?? '', secretKey: process.env.SUPABASE_SECRET_KEY ?? '' })));
  } catch { console.error('Relocation publication failed; inspect validation/configuration without exposing credentials.'); process.exitCode = 1; }
}
