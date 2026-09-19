import { z } from 'zod';
import { readBoundedJson, supabaseBaseUrl } from './neighborhoods.js';

export const AMENITY_CATEGORIES = ['parks', 'libraries', 'community_centers', 'hospitals', 'health_facilities', 'multi_service_centers', 'museums', 'schools'] as const;
const category = z.enum(AMENITY_CATEGORIES);
const id = z.number().int().min(1).max(88);
const timestamp = z.iso.datetime({ offset: true });
const httpsUrl = z.string().max(2_000).url().refine(value => value.startsWith('https://'));
export const amenitiesInputSchema = z.object({ neighborhood_id: id, category: category.optional(), limit: z.number().int().min(1).max(100).default(20) }).strict();
export const conditionsInputSchema = z.object({ neighborhood_id: id.optional(), limit: z.number().int().min(1).max(20).default(10) }).strict();

const sourceSchema = z.object({
  source_id: z.string().regex(/^[a-z_]{1,60}$/), category, source_url: httpsUrl,
  source_checked_at: timestamp, source_published_at: timestamp.nullable(), source_period: z.string().max(300).nullable(),
  source_count: z.number().int().min(0).max(5_000), published_count: z.number().int().min(0).max(5_000),
  attribution: z.string().max(500), note: z.string().max(5_000), data_version: z.string().max(200),
  boundary_version: z.string().max(200).nullable().optional(), availability: z.enum(['reference_snapshot', 'needs_rejoin']),
  geometry_repair_count: z.number().int().min(0).max(5_000).optional(),
});
const placeSchema = z.object({ type: z.literal('Feature'), id: z.string().min(1).max(200), properties: z.object({
  name: z.string().min(1).max(300), address: z.string().max(1_000).nullable(), category,
  source_id: z.string().regex(/^[a-z_]{1,60}$/), neighborhood_ids: z.array(id).min(1).max(88),
  location_method: z.enum(['source_point', 'point_on_surface']),
}) });
const placesSchema = z.object({ type: z.literal('FeatureCollection'), neighborhood_id: id, sources: z.array(sourceSchema).max(32), features: z.array(placeSchema).max(5_000) });
type Places = z.infer<typeof placesSchema>;

const alertSchema = z.object({
  event: z.string().max(160), headline: z.string().max(2_000).nullable(), severity: z.string().max(40),
  certainty: z.string().max(40), urgency: z.string().max(40), areaDesc: z.string().max(8_000),
  sent: timestamp, sent_at: timestamp, expires: timestamp, valid_until: timestamp,
  onset: timestamp.nullable(), ends: timestamp.nullable(), source_url: httpsUrl,
});
const gaugeSchema = z.object({
  monitoring_location_id: z.string().max(80), time_series_id: z.string().max(160), parameter_code: z.literal('00065'),
  time: timestamp, observed_at: timestamp, valid_until: timestamp, value: z.number().finite(), unit_of_measure: z.literal('ft'),
  approval_status: z.enum(['Provisional', 'Approved']), qualifier: z.string().max(200).nullable(), source_url: httpsUrl,
});
const feedSchema = z.object({
  source_id: z.enum(['nws_alerts', 'usgs_gauges']), availability: z.enum(['current', 'no_current_observations', 'stale', 'unavailable']),
  source_url: httpsUrl.optional(), source_checked_at: timestamp.optional(), source_published_at: timestamp.nullable().optional(),
  valid_until: timestamp.optional(), record_count: z.number().int().min(0).max(500).optional(), attribution: z.string().max(500).optional(),
  note: z.string().max(5_000).optional(), payload: z.object({ type: z.literal('FeatureCollection'), features: z.array(z.object({
    type: z.literal('Feature'), id: z.string().min(1).max(2_000), properties: z.record(z.string(), z.unknown()),
  })).max(500) }).nullable(),
}).superRefine((feed, ctx) => {
  if (feed.availability !== 'unavailable' && (!feed.source_url || !feed.source_checked_at || !feed.source_published_at ||
      !feed.valid_until || feed.record_count === undefined || !feed.attribution || !feed.note)) {
    ctx.addIssue({ code: 'custom', message: 'Feed provenance is incomplete.' });
  }
  if ((feed.availability === 'current' || feed.availability === 'no_current_observations') && !feed.payload) {
    ctx.addIssue({ code: 'custom', message: 'Current feed has no payload.' });
  }
  if (feed.payload && feed.payload.features.length !== feed.record_count) ctx.addIssue({ code: 'custom', message: 'Feed count mismatch.' });
});
const conditionsSchema = z.object({ checked_at: timestamp, neighborhood_id: id.nullable(), feeds: z.array(feedSchema).length(2) });
type Conditions = z.infer<typeof conditionsSchema>;
type Entry<T> = { data?: T; expires: number; inflight?: Promise<T> };

function parsePlaces(value: unknown, neighborhoodId: number): Places {
  const rows = placesSchema.parse(value);
  if (rows.neighborhood_id !== neighborhoodId) throw new Error('Wrong neighborhood response.');
  if (new Set(rows.sources.map(s => s.source_id)).size !== rows.sources.length ||
      new Set(rows.features.map(f => f.id)).size !== rows.features.length) throw new Error('Duplicate place/source IDs.');
  for (const feature of rows.features) {
    const source = rows.sources.find(s => s.source_id === feature.properties.source_id);
    if (!feature.properties.neighborhood_ids.includes(neighborhoodId) || !source || source.availability !== 'reference_snapshot' ||
        source.category !== feature.properties.category) throw new Error('Place provenance or membership mismatch.');
  }
  return rows;
}
function parseConditions(value: unknown, neighborhoodId: number | undefined): Conditions {
  const body = conditionsSchema.parse(value);
  if (body.neighborhood_id !== (neighborhoodId ?? null) || new Set(body.feeds.map(f => f.source_id)).size !== 2) {
    throw new Error('Wrong current-context scope or duplicate sources.');
  }
  for (const feed of body.feeds) for (const feature of feed.payload?.features ?? []) {
    feature.properties = feed.source_id === 'nws_alerts' ? alertSchema.parse(feature.properties) : gaugeSchema.parse(feature.properties);
  }
  return body;
}

export function createContextClient(options: {
  url: string; publishableKey: string; fetch?: typeof globalThis.fetch; now?: () => number;
  amenitiesCacheMs?: number; currentCacheMs?: number;
}) {
  const base = supabaseBaseUrl(options.url);
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(options.publishableKey)) throw new Error('A modern publishable key is required; admin keys are forbidden.');
  const fetcher = options.fetch ?? globalThis.fetch, now = options.now ?? Date.now;
  const amenitiesTtl = options.amenitiesCacheMs ?? 3_600_000, currentTtl = options.currentCacheMs ?? 60_000;
  if (!Number.isFinite(amenitiesTtl) || amenitiesTtl < 0 || amenitiesTtl > 3_600_000 ||
      !Number.isFinite(currentTtl) || currentTtl < 0 || currentTtl > 60_000) throw new Error('Cache exceeds its allowed lifetime.');
  const places = new Map<number, Entry<Places>>(), conditions = new Map<number | undefined, Entry<Conditions>>();
  async function read<T>(rpc: 'get_neighborhood_places' | 'get_current_context', neighborhoodId: number | undefined, parse: (data: unknown) => T): Promise<T> {
    const query = neighborhoodId === undefined ? '' : `?p_neighborhood_id=${neighborhoodId}`;
    const response = await fetcher(`${base}/rest/v1/rpc/${rpc}${query}`, {
      method: 'GET', headers: { apikey: options.publishableKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000), redirect: 'error',
    });
    return parse(await readBoundedJson(response, 2_000_000));
  }
  async function cached<T, K>(map: Map<K, Entry<T>>, key: K, ttl: number, load: () => Promise<T>): Promise<T> {
    let entry = map.get(key);
    if (!entry) { entry = { expires: 0 }; map.set(key, entry); }
    if (entry.data && now() < entry.expires) return structuredClone(entry.data);
    if (!entry.inflight) {
      const slot = entry;
      slot.inflight = load().then(data => { slot.data = data; slot.expires = now() + ttl; return data; })
        .finally(() => { slot.inflight = undefined; });
    }
    return structuredClone(await entry.inflight!);
  }
  return {
    async getAmenities(input: unknown) {
      const args = amenitiesInputSchema.parse(input);
      // Cache all categories for this neighborhood once; category/limit changes are local.
      const body = await cached(places, args.neighborhood_id, amenitiesTtl, () =>
        read('get_neighborhood_places', args.neighborhood_id, value => parsePlaces(value, args.neighborhood_id)));
      const sources = body.sources.filter(s => !args.category || s.category === args.category);
      const matches = body.features.filter(f => !args.category || f.properties.category === args.category);
      const categories = args.category ? [args.category] : [...AMENITY_CATEGORIES];
      const counts = Object.fromEntries(categories.map(c => [c, sources.some(s => s.category === c && s.availability === 'reference_snapshot') ?
        matches.filter(f => f.properties.category === c).length : null]));
      const available = Object.values(counts).filter(value => value !== null).length;
      return {
        neighborhood_id: args.neighborhood_id, category: args.category ?? null,
        availability: available === 0 ? 'unavailable' : available === categories.length ? 'reference_snapshot' : 'partial',
        counts, total_matches: available ? matches.length : null, returned_records: Math.min(matches.length, args.limit),
        truncated: matches.length > args.limit, sources,
        amenities: matches.slice(0, args.limit).map(f => ({ place_id: f.id, ...f.properties })),
        interpretation: 'Facility inventory by neighborhood intersection, not current opening status, admission availability, school quality, or travel time. Missing source categories are unknown (null), not zero. Parks can belong to multiple neighborhoods; representative points are not entrances.',
      };
    },
    async getCurrentConditions(input: unknown = {}) {
      const args = conditionsInputSchema.parse(input);
      const body = await cached(conditions, args.neighborhood_id, currentTtl, () =>
        read('get_current_context', args.neighborhood_id, value => parseConditions(value, args.neighborhood_id)));
      const checked = now(), futureTolerance = 300_000, feedAge = 1_800_000, observationAge = 21_600_000;
      let remaining = args.limit;
      const feeds = body.feeds.map(feed => {
        const { payload: ignoredPayload, record_count: ignoredCount, ...metadata } = feed;
        let availability = feed.availability;
        let features = feed.payload?.features ?? [];
        if (availability === 'current' || availability === 'no_current_observations') {
          const sourceChecked = Date.parse(feed.source_checked_at!), published = Date.parse(feed.source_published_at!);
          if (sourceChecked > checked + futureTolerance || published > checked + futureTolerance ||
              Date.parse(feed.valid_until!) <= checked || checked - sourceChecked > feedAge ||
              checked - published > (feed.source_id === 'nws_alerts' ? feedAge : observationAge)) {
            availability = 'stale'; features = [];
          } else {
            features = features.filter(f => {
              const expires = Date.parse(String(f.properties.valid_until));
              const observed = Date.parse(String(f.properties.sent_at ?? f.properties.observed_at));
              const ownExpiry = feed.source_id === 'nws_alerts' ? Date.parse(String(f.properties.expires)) : observed + observationAge;
              return expires > checked && ownExpiry > checked && observed <= checked + futureTolerance;
            });
            if (feed.source_id === 'usgs_gauges' && !features.length) availability = 'no_current_observations';
          }
        } else features = [];
        const records = features.slice(0, remaining).map(f => ({ id: f.id, ...f.properties }));
        remaining -= records.length;
        return { ...metadata, availability, total_records: ['stale', 'unavailable'].includes(availability) ? null : features.length,
          returned_records: records.length, truncated: features.length > records.length, records };
      });
      return {
        neighborhood_id: args.neighborhood_id ?? null, server_checked_at: body.checked_at, evaluated_at: new Date(checked).toISOString(),
        returned_records: args.limit - remaining, feeds,
        interpretation: 'Current operational context only. A fresh empty NWS feed means no active alerts reported for this scope; unavailable/stale does not. Alerts without polygons retain county scope. USGS provisional gage heights use station-specific references, not flood depth at a home, neighborhood flood likelihood, safety, or a ranking.',
      };
    },
  };
}
export type ContextClient = ReturnType<typeof createContextClient>;
