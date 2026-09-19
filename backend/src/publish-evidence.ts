import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { REPORT_CATEGORIES } from './evidence.js';
import { readBoundedJson, supabaseBaseUrl } from './neighborhoods.js';

const rowSchema = z.object({
  id: z.string(), neighborhood_id: z.number().int().min(1).max(88), category_id: z.enum(REPORT_CATEGORIES),
  availability: z.enum(['reference_snapshot', 'partial', 'unavailable']), facts: z.record(z.string(), z.unknown()),
  sources: z.array(z.object({ source_id: z.string().min(1), source_url: z.url().refine(s => s.startsWith('https://')),
    source_checked_at: z.iso.datetime({ offset: true }), source_period: z.string().min(1).nullable(),
  }).passthrough()).max(20),
  missing_inputs: z.array(z.string()), limitations: z.array(z.string()), dependencies: z.array(z.record(z.string(), z.unknown())).max(12),
  boundary_version: z.string().regex(/^coh-sn-boundaries-[a-f0-9]{16}$/), evidence_version: z.string().regex(/^report-evidence-[a-f0-9]{16}$/),
  prepared_at: z.iso.datetime({ offset: true }), refresh_due_at: z.iso.datetime({ offset: true }),
}).strict();
export function validateEvidenceRows(value: unknown) {
  const rows = z.array(rowSchema).length(704).parse(value);
  if (new Set(rows.map(r => r.id)).size !== 704 || new Set(rows.map(r => r.evidence_version)).size !== 1 ||
    new Set(rows.map(r => r.boundary_version)).size !== 1 || rows.some(r => r.id !== `evidence:${r.neighborhood_id}:${r.category_id}` ||
      Date.parse(r.refresh_due_at) <= Date.parse(r.prepared_at) ||
      (r.availability !== 'unavailable' && (!r.sources.length || !Object.keys(r.facts).length)))) throw new Error('Invalid evidence release.');
  return rows;
}
export function evidenceBatches(input: unknown, targetBytes = 80_000) {
  if (!Number.isInteger(targetBytes) || targetBytes < 1_000 || targetBytes > 1_900_000) throw new Error('Invalid batch size.');
  const rows = validateEvidenceRows(input), batches: (typeof rows)[] = [];
  let batch: typeof rows = [], bytes = 2;
  for (const row of rows) {
    const size = Buffer.byteLength(JSON.stringify(row));
    if (size > 1_899_000) throw new Error('Evidence row too large.');
    if (batch.length && (batch.length >= 100 || bytes + size + 1 > targetBytes)) { batches.push(batch); batch = []; bytes = 2; }
    batch.push(row); bytes += size + 1;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
export function createEvidencePublisher(options: { url: string; secretKey: string; fetch?: typeof fetch }) {
  const base = supabaseBaseUrl(options.url), fetcher = options.fetch ?? fetch;
  if (!/^sb_secret_[A-Za-z0-9_-]+$/.test(options.secretKey)) throw new Error('A server-only modern secret key is required.');
  return { async publish(input: unknown) {
    const batches = evidenceBatches(input), version = batches[0]![0]!.evidence_version;
    const batchId = `evidence:${version}`;
    const rpc = async (name: string, body: unknown) => readBoundedJson(await fetcher(`${base}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: { apikey: options.secretKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(60_000),
    }));
    for (const batch of batches) await rpc('stage_geo_import', { p_batch: batchId, p_features: batch });
    return rpc('publish_neighborhood_evidence', { p_batch: batchId });
  } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const snapshot = JSON.parse(await readFile(new URL('../data/neighborhood-evidence.json', import.meta.url), 'utf8'));
    console.log(JSON.stringify(await createEvidencePublisher({ url: process.env.SUPABASE_URL ?? '', secretKey: process.env.SUPABASE_SECRET_KEY ?? '' }).publish(snapshot.rows)));
  } catch (error) { console.error(error instanceof Error ? error.message : 'Evidence publication failed.'); process.exitCode = 1; }
}
