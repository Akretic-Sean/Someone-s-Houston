import { z } from 'zod';
import { readBoundedJson, supabaseBaseUrl } from './neighborhoods.js';

export const REPORT_CATEGORIES = ['afford', 'commute', 'flood', 'amen', 'fit', 'food', 'air', 'health'] as const;
export const evidenceInputSchema = z.object({ neighborhood_id: z.number().int().min(1).max(88) }).strict();
const categoryId = z.enum(REPORT_CATEGORIES);
const evidenceSchema = z.object({
  availability: z.enum(['reference_snapshot', 'partial', 'unavailable', 'needs_refresh']),
  facts: z.record(z.string(), z.unknown()).nullable(),
  sources: z.array(z.object({ source_id: z.string().min(1),
    source_url: z.url().refine(url => url.startsWith('https://')),
    source_period: z.string().min(1).nullable(), source_checked_at: z.iso.datetime({ offset: true }),
  }).passthrough()).max(20),
  missing_inputs: z.array(z.string()), limitations: z.array(z.string()),
  evidence_version: z.string().regex(/^report-evidence-[a-f0-9]{16}$/).nullable(),
  prepared_at: z.iso.datetime({ offset: true }).nullable(),
  refresh_due_at: z.iso.datetime({ offset: true }).nullable(),
  score: z.null(), score_status: z.literal('not_implemented'),
});
const responseSchema = z.object({
  profile_id: z.literal('report-priorities-v1'), weight_total: z.literal(54),
  evaluated_at: z.iso.datetime({ offset: true }),
  category_definitions: z.array(z.object({ id: categoryId, label: z.string(), default_weight: z.number().int().min(0).max(10) })).length(8),
  safety: z.object({ weighted: z.literal(false), tier: z.null(), availability: z.literal('unavailable'), reason: z.string() }),
  neighborhoods: z.array(z.object({ neighborhood_id: z.number().int().min(1).max(88), name: z.string(),
    reference_point: z.object({ latitude: z.number().min(29).max(31), longitude: z.number().min(-96.5).max(-94.5), method: z.literal('source_polygon_center') }),
    categories: z.record(categoryId, evidenceSchema),
  })).length(1),
  interpretation: z.string(),
});
export type NeighborhoodEvidence = z.infer<typeof responseSchema>;

export function parseEvidence(value: unknown, id: number): NeighborhoodEvidence {
  const data = responseSchema.parse(value);
  if (data.neighborhoods[0]!.neighborhood_id !== id ||
      new Set(data.category_definitions.map(c => c.id)).size !== 8 ||
      data.category_definitions.reduce((sum, c) => sum + c.default_weight, 0) !== data.weight_total) {
    throw new Error('Evidence scope or category configuration mismatch.');
  }
  for (const evidence of Object.values(data.neighborhoods[0]!.categories)) {
    const usable = ['partial', 'reference_snapshot'].includes(evidence.availability);
    if (usable && (!evidence.facts || !Object.keys(evidence.facts).length || !evidence.sources.length ||
      !evidence.evidence_version || !evidence.prepared_at || !evidence.refresh_due_at ||
      Date.parse(evidence.refresh_due_at) <= Date.parse(evidence.prepared_at))) throw new Error('Usable evidence lacks provenance or validity.');
    if (!usable && evidence.facts !== null) throw new Error('Unavailable evidence exposes facts.');
  }
  return data;
}

export function createEvidenceClient(options: {
  url: string; publishableKey: string; fetch?: typeof globalThis.fetch; now?: () => number; cacheMs?: number;
}) {
  const base = supabaseBaseUrl(options.url);
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(options.publishableKey)) throw new Error('A modern publishable key is required.');
  const fetcher = options.fetch ?? globalThis.fetch, now = options.now ?? Date.now, ttl = options.cacheMs ?? 3_600_000;
  if (!Number.isFinite(ttl) || ttl < 0 || ttl > 3_600_000) throw new Error('Evidence cache must be 0-1 hour.');
  const cache = new Map<number, { expires: number; data?: NeighborhoodEvidence; inflight?: Promise<NeighborhoodEvidence> }>();
  return {
    async getEvidence(input: unknown): Promise<NeighborhoodEvidence> {
      const { neighborhood_id: id } = evidenceInputSchema.parse(input);
      let slot = cache.get(id);
      if (!slot) { slot = { expires: 0 }; cache.set(id, slot); }
      if (!slot.data || now() >= slot.expires) {
        const entry = slot;
        if (!entry.inflight) entry.inflight = (async () => {
          const response = await fetcher(`${base}/rest/v1/rpc/get_neighborhood_evidence?p_neighborhood_id=${id}`, {
            headers: { apikey: options.publishableKey }, signal: AbortSignal.timeout(15_000), redirect: 'error',
          });
          const body = parseEvidence(await readBoundedJson(response, 500_000), id);
          entry.data = body; entry.expires = now() + ttl; return body;
        })().finally(() => { entry.inflight = undefined; });
        await entry.inflight;
      }
      const output = structuredClone(slot.data!);
      output.evaluated_at = new Date(now()).toISOString();
      for (const e of Object.values(output.neighborhoods[0]!.categories)) {
        if (['reference_snapshot', 'partial'].includes(e.availability) &&
          (Date.parse(e.refresh_due_at!) <= now() || Date.parse(e.prepared_at!) > now() + 300_000)) {
          e.availability = 'needs_refresh'; e.facts = null;
        }
      }
      return output;
    },
  };
}
export type EvidenceClient = ReturnType<typeof createEvidenceClient>;
