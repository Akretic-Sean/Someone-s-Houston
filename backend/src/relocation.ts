import { z } from 'zod';
import { readBoundedJson, supabaseBaseUrl } from './neighborhoods.js';

export const relocationInputSchema = z.object({ neighborhood_id: z.number().int().min(1).max(88) }).strict();
const timestamp = z.iso.datetime({ offset: true });
const sourceSchema = z.object({
  source_id: z.string().min(1), source_url: z.url().refine(v => v.startsWith('https://')),
  source_period: z.string().nullable(), source_checked_at: timestamp,
}).passthrough();
const availability = z.enum(['reference_snapshot', 'partial', 'historical_snapshot', 'scheduled_snapshot', 'unavailable', 'needs_refresh']);
const blockSchema = z.object({
  availability, facts: z.record(z.string(), z.unknown()).nullable(), refresh_due_at: timestamp.nullable(),
  source: sourceSchema.nullable().optional(), sources: z.array(sourceSchema).optional(),
}).passthrough();
const count = z.number().int().min(0).max(20000);
const transitFacts = z.object({
  stop_count: count, active_route_count: count, rail_stop_count: count,
  service_dates: z.array(z.iso.date()).length(7),
  routes: z.array(z.object({ route_id: z.string().min(1), short_name: z.string(), long_name: z.string(), route_type: z.number().int().min(0) })).max(1000),
  nearest_stops: z.array(z.object({
    stop_id: z.string().min(1), name: z.string().min(1).max(300), latitude: z.number().min(28).max(31.5), longitude: z.number().min(-97.5).max(-94),
    route_ids: z.array(z.string()).min(1).max(1000), neighborhood_ids: z.array(z.number().int().min(1).max(88)),
    straight_line_meters: z.number().int().nonnegative(), inside_neighborhood: z.boolean(),
  })).min(1).max(5),
});
const crimeFacts = z.object({ year: z.literal(2024), source_neighborhood_name: z.string(), counts: z.object({
  aggravated_assault: count.nullable(), robbery: count.nullable(), burglary: count.nullable(),
  motor_vehicle_theft: count.nullable(), theft_from_motor_vehicle: count.nullable(),
}).strict() }).strict();
const schoolFacts = z.object({ count, returned_count: z.number().int().min(0).max(20), truncated: z.boolean(),
  schools: z.array(z.object({ place_id: z.string(), name: z.string(), latitude: z.number(), longitude: z.number(), location_method: z.string() })).max(20),
});
const responseSchema = z.object({
  schema_version: z.literal(1), neighborhood_id: z.number().int().min(1).max(88), evaluated_at: timestamp,
  scoring_effect: z.literal('none'), housing: blockSchema, schools: blockSchema,
  transit: blockSchema, reported_crime: blockSchema,
  safety: z.object({ tier: z.null(), availability: z.literal('unavailable'), weighted: z.literal(false) }),
  official_links: z.object({ crime: z.url(), schools: z.url(), childcare: z.url() }),
});
export type RelocationContext = z.infer<typeof responseSchema>;
const usable = (value: string) => !['unavailable', 'needs_refresh'].includes(value);

export function parseRelocationContext(input: unknown, id: number): RelocationContext {
  const data = responseSchema.parse(input);
  if (data.neighborhood_id !== id) throw new Error('Relocation context scope mismatch');
  for (const key of ['housing', 'schools', 'transit', 'reported_crime'] as const) {
    const block = data[key];
    if (usable(block.availability)) {
      if (!block.facts || !block.refresh_due_at || (!block.source && !block.sources?.length)) throw new Error('Context lacks provenance or validity');
    } else if (block.facts !== null) throw new Error('Unavailable context exposes facts');
  }
  if (data.transit.facts) {
    const t = transitFacts.parse(data.transit.facts);
    if (t.routes.length !== t.active_route_count || t.rail_stop_count > t.stop_count || new Set(t.routes.map(r => r.route_id)).size !== t.routes.length ||
        t.service_dates.some((d, i) => Date.parse(d) !== Date.parse(t.service_dates[0]!) + i * 86400000)) throw new Error('Inconsistent transit summary');
    if (data.transit.availability !== 'scheduled_snapshot') throw new Error('Transit must be labeled scheduled');
  }
  if (data.reported_crime.facts) {
    crimeFacts.parse(data.reported_crime.facts);
    if (data.reported_crime.availability !== 'historical_snapshot') throw new Error('Crime must be labeled historical');
  }
  if (data.schools.facts) {
    const s = schoolFacts.parse(data.schools.facts);
    if (s.returned_count !== s.schools.length || s.count < s.returned_count || s.truncated !== (s.count > s.returned_count)) throw new Error('Inconsistent school summary');
  }
  return data;
}

export function createRelocationClient(options: {
  url: string; publishableKey: string; fetch?: typeof globalThis.fetch; now?: () => number; cacheMs?: number;
}) {
  const base = supabaseBaseUrl(options.url), fetcher = options.fetch ?? fetch, now = options.now ?? Date.now;
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(options.publishableKey)) throw new Error('A public publishable key is required');
  const ttl = options.cacheMs ?? 3_600_000;
  if (!Number.isFinite(ttl) || ttl < 0 || ttl > 3_600_000) throw new Error('Cache must be 0-1 hour');
  const cache = new Map<number, { expires: number; data?: RelocationContext; inflight?: Promise<void> }>();
  return {
    async getRelocationContext(input: unknown): Promise<RelocationContext> {
      const { neighborhood_id: id } = relocationInputSchema.parse(input);
      let slot = cache.get(id);
      if (!slot) { slot = { expires: 0 }; cache.set(id, slot); }
      if (!slot.data || now() >= slot.expires) {
        const entry = slot;
        if (!entry.inflight) entry.inflight = (async () => {
          const response = await fetcher(`${base}/rest/v1/rpc/get_neighborhood_relocation_context?p_neighborhood_id=${id}`, {
            headers: { apikey: options.publishableKey }, signal: AbortSignal.timeout(15_000), redirect: 'error',
          });
          const body = parseRelocationContext(await readBoundedJson(response, 150_000), id);
          if (Date.parse(body.evaluated_at) > now() + 300_000) throw new Error('Future-dated context response');
          const deadlines = [body.housing, body.schools, body.transit, body.reported_crime]
            .filter(b => usable(b.availability)).map(b => Date.parse(b.refresh_due_at!));
          entry.data = body; entry.expires = Math.min(now() + ttl, ...deadlines);
        })().finally(() => { entry.inflight = undefined; });
        await entry.inflight;
      }
      const data = structuredClone(slot.data!);
      data.evaluated_at = new Date(now()).toISOString();
      for (const block of [data.housing, data.schools, data.transit, data.reported_crime]) {
        const sources = block.source ? [block.source] : block.sources ?? [];
        if (usable(block.availability) && (Date.parse(block.refresh_due_at!) <= now() || sources.some(s => Date.parse(s.source_checked_at)>now()+300_000))) {
          block.availability = 'needs_refresh'; block.facts = null;
        }
      }
      return data;
    },
  };
}
export type RelocationClient = ReturnType<typeof createRelocationClient>;
