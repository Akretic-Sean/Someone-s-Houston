/** Small public operational snapshots, usable in Node and Supabase Edge Functions. */
export type FeedSource = 'nws_alerts' | 'usgs_gauges';
type JsonObject = Record<string, unknown>;
export type FeedFeature = { type: 'Feature'; id: string; geometry: JsonObject | null; properties: JsonObject };
export type LiveFeed = {
  source_id: FeedSource;
  source_url: string;
  source_checked_at: string;
  source_published_at: string | null;
  valid_until: string;
  payload: { type: 'FeatureCollection'; features: FeedFeature[] };
  record_count: number;
  attribution: string;
  note: string;
};

export const ALERTS_URL = 'https://api.weather.gov/alerts/active?zone=TXC201,TXC157,TXC339';
export const GAUGES_URL = 'https://api.waterdata.usgs.gov/ogcapi/v1/collections/latest-continuous/items';
export const HOUSTON_GAUGE_BBOX = [-95.9, 29.4, -95.0, 30.2] as const;
const USER_AGENT = 'hou-match/0.1 (https://github.com/Akretic-Sean/Someone-s-Houston)';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const FUTURE_TOLERANCE = 5 * MINUTE;
const SNAPSHOT_TTL = 30 * MINUTE;
const GAUGE_MAX_AGE = 6 * HOUR;
const MAX_BYTES = 2_000_000;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}.`);
  return value as JsonObject;
}
function string(value: unknown, label: string, max = 1_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${label}.`);
  return value;
}
function timestamp(value: unknown, label: string): number {
  const text = string(value, label, 64);
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(text)) throw new Error(`Invalid ${label}.`);
  const result = Date.parse(text);
  if (!Number.isFinite(result)) throw new Error(`Invalid ${label}.`);
  return result;
}
function date(value: unknown, label: string): string { return new Date(timestamp(value, label)).toISOString(); }
function optionalDate(value: unknown, label: string): string | null {
  return value === undefined || value === null ? null : date(value, label);
}
function recent(value: unknown, label: string, now: number, maxAge: number): number {
  const t = timestamp(value, label);
  if (t > now + FUTURE_TOLERANCE || now - t > maxAge) throw new Error(`Stale or future ${label}.`);
  return t;
}
function collection(value: unknown, maxRows: number): JsonObject[] {
  const body = object(value, 'feed');
  if (body.type !== 'FeatureCollection' || !Array.isArray(body.features) || body.features.length > maxRows) {
    throw new Error('Invalid or oversized FeatureCollection.');
  }
  if ((body.pagination && object(body.pagination, 'pagination').next) ||
      (Array.isArray(body.links) && body.links.some(link => object(link, 'link').rel === 'next'))) {
    throw new Error('Source requires pagination; refusing an incomplete snapshot.');
  }
  if (typeof body.numberReturned === 'number' && body.numberReturned !== body.features.length) {
    throw new Error('Source row count does not match its features.');
  }
  return body.features.map(value => {
    const feature = object(value, 'feature');
    if (feature.type !== 'Feature') throw new Error('Invalid GeoJSON feature.');
    return feature;
  });
}
function point(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length !== 2 || value.some(n => typeof n !== 'number' || !Number.isFinite(n))) {
    throw new Error('Invalid coordinate.');
  }
  const lon = value[0] as number, lat = value[1] as number;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) throw new Error('Coordinate outside EPSG:4326.');
  return [lon, lat];
}
function alertGeometry(value: unknown): JsonObject | null {
  if (value === null) return null;
  const geometry = object(value, 'alert geometry');
  if (!['Polygon', 'MultiPolygon'].includes(String(geometry.type))) throw new Error('Unsupported alert geometry.');
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  if (!Array.isArray(polygons) || polygons.length === 0) throw new Error('Invalid alert polygons.');
  let vertices = 0;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length === 0) throw new Error('Invalid alert polygon.');
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4) throw new Error('Invalid alert ring.');
      const coordinates = ring.map(point);
      vertices += coordinates.length;
      if (vertices > 50_000) throw new Error('Alert geometry exceeds vertex limit.');
      const first = coordinates[0]!, last = coordinates.at(-1)!;
      if (first[0] !== last[0] || first[1] !== last[1]) throw new Error('Alert polygon is not closed.');
    }
  }
  return { type: geometry.type, coordinates: geometry.coordinates };
}
async function fetchJson(url: string, fetcher: typeof globalThis.fetch): Promise<unknown> {
  const response = await fetcher(url, {
    headers: { Accept: 'application/geo+json, application/json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Provider request failed (HTTP ${response.status}).`);
  if (!/\bapplication\/(?:geo\+)?json\b/i.test(response.headers.get('content-type') ?? '')) {
    throw new Error('Provider did not return JSON.');
  }
  const declared = response.headers.get('content-length');
  if (declared && Number(declared) > MAX_BYTES) throw new Error('Provider response exceeds byte limit.');
  if (!response.body) throw new Error('Provider response has no body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) throw new Error('Provider response exceeds byte limit.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
function base(source: FeedSource, url: string, now: number, published: number): Omit<LiveFeed, 'payload' | 'record_count' | 'attribution' | 'note'> {
  return {
    source_id: source, source_url: url, source_checked_at: new Date(now).toISOString(),
    source_published_at: new Date(published).toISOString(), valid_until: new Date(now + SNAPSHOT_TTL).toISOString(),
  };
}
async function alerts(fetcher: typeof globalThis.fetch, now: number): Promise<LiveFeed> {
  const body = object(await fetchJson(ALERTS_URL, fetcher), 'NWS feed');
  const rows = collection(body, 200);
  // Even a successful empty response must carry a recent provider update time.
  const published = recent(body.updated, 'NWS update', now, SNAPSHOT_TTL);
  const unique = new Map<string, FeedFeature>();
  let excluded = 0;
  for (const row of rows) {
    const p = object(row.properties, 'alert properties');
    const id = string(row.id ?? p.id, 'alert ID', 2_000);
    if (!id.startsWith('https://api.weather.gov/alerts/')) throw new Error('Unexpected alert source URL.');
    const expires = timestamp(p.expires, 'alert expiry');
    if (p.status !== 'Actual' || p.messageType === 'Cancel' || expires <= now) { excluded++; continue; }
    const sent = timestamp(p.sent, 'alert sent');
    if (sent > now + FUTURE_TOLERANCE) throw new Error('Future alert sent timestamp.');
    if (expires <= sent) throw new Error('Alert expiry precedes its sent time.');
    const geocode = object(p.geocode, 'alert geocode');
    if (!Array.isArray(geocode.UGC) || geocode.UGC.length > 500) throw new Error('Invalid alert zone codes.');
    const properties = {
      event: string(p.event, 'alert event', 160), headline: p.headline == null ? null : string(p.headline, 'headline', 2_000),
      severity: string(p.severity, 'severity', 40), certainty: string(p.certainty, 'certainty', 40),
      urgency: string(p.urgency, 'urgency', 40), areaDesc: string(p.areaDesc, 'area description', 8_000),
      sent: new Date(sent).toISOString(), sent_at: new Date(sent).toISOString(),
      valid_until: new Date(expires).toISOString(), effective: optionalDate(p.effective, 'effective time'),
      onset: optionalDate(p.onset, 'onset time'), expires: new Date(expires).toISOString(),
      ends: optionalDate(p.ends, 'end time'),
      geocode: { UGC: geocode.UGC.map(code => string(code, 'zone code', 12)) },
      source_url: id,
    };
    const feature: FeedFeature = { type: 'Feature', id, geometry: alertGeometry(row.geometry), properties };
    const previous = unique.get(id);
    if (!previous || timestamp(previous.properties.sent, 'stored sent') <= sent) unique.set(id, feature);
  }
  const features = [...unique.values()].sort((a, b) => a.id.localeCompare(b.id));
  return {
    ...base('nws_alerts', ALERTS_URL, now, published),
    valid_until: new Date(Math.min(now, published) + SNAPSHOT_TTL).toISOString(),
    payload: { type: 'FeatureCollection', features }, record_count: features.length,
    attribution: 'National Weather Service / NOAA',
    note: `Active alerts for Harris, Fort Bend, and Montgomery counties; county scope does not mean every neighborhood is affected. ${excluded} expired, cancelled, or non-actual records excluded. An empty fresh snapshot means the provider reported no active alerts in this scope. Operational context, not a neighborhood risk score.`,
  };
}
async function gauges(fetcher: typeof globalThis.fetch, now: number): Promise<LiveFeed> {
  const query = new URLSearchParams({
    f: 'json', bbox: HOUSTON_GAUGE_BBOX.join(','), parameter_code: '00065',
    datetime: `${new Date(now - GAUGE_MAX_AGE).toISOString()}/..`, limit: '500',
  });
  const url = `${GAUGES_URL}?${query}`;
  const body = await fetchJson(url, fetcher);
  const rows = collection(body, 500);
  const unique = new Map<string, FeedFeature>();
  let excluded = 0;
  for (const row of rows) {
    const p = object(row.properties, 'gauge properties');
    const observed = timestamp(p.time, 'gauge observation');
    if (observed > now + FUTURE_TOLERANCE) throw new Error('Future gauge observation.');
    if (now - observed > GAUGE_MAX_AGE || p.value === null || p.value === '' || p.value === undefined) { excluded++; continue; }
    const value = typeof p.value === 'number' ? p.value : typeof p.value === 'string' &&
      /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(p.value.trim()) ? Number(p.value) : NaN;
    if (!Number.isFinite(value)) { excluded++; continue; }
    if (p.parameter_code !== '00065' || p.unit_of_measure !== 'ft') throw new Error('Unexpected gauge parameter or unit.');
    const geometry = object(row.geometry, 'gauge geometry');
    if (geometry.type !== 'Point') throw new Error('Gauge geometry must be a point.');
    const [lon, lat] = point(geometry.coordinates);
    if (lon < HOUSTON_GAUGE_BBOX[0] || lat < HOUSTON_GAUGE_BBOX[1] || lon > HOUSTON_GAUGE_BBOX[2] || lat > HOUSTON_GAUGE_BBOX[3]) {
      throw new Error('Gauge lies outside the requested Houston extent.');
    }
    const id = string(p.time_series_id, 'gauge series ID', 160);
    const location = string(p.monitoring_location_id, 'monitoring location', 80);
    if (!/^USGS-[A-Za-z0-9]+$/.test(location)) throw new Error('Unexpected monitoring location ID.');
    if (p.approval_status !== 'Provisional' && p.approval_status !== 'Approved') throw new Error('Unknown gauge approval status.');
    const feature: FeedFeature = {
      type: 'Feature', id, geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        time_series_id: id, monitoring_location_id: location, parameter_code: '00065',
        time: new Date(observed).toISOString(), observed_at: new Date(observed).toISOString(),
        valid_until: new Date(observed + GAUGE_MAX_AGE).toISOString(),
        value, unit_of_measure: 'ft', approval_status: p.approval_status,
        qualifier: p.qualifier == null ? null : string(p.qualifier, 'gauge qualifier', 200),
        last_modified: optionalDate(p.last_modified, 'gauge modification'),
        source_url: `https://waterdata.usgs.gov/monitoring-location/${location}/`,
      },
    };
    const previous = unique.get(id);
    if (!previous || timestamp(previous.properties.time, 'stored observation') <= observed) unique.set(id, feature);
  }
  const features = [...unique.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (!features.length) throw new Error('No usable recent gauge observations; preserving the previous snapshot.');
  const published = Math.max(...features.map(f => timestamp(f.properties.time, 'gauge observation')));
  return {
    ...base('usgs_gauges', url, now, published), payload: { type: 'FeatureCollection', features }, record_count: features.length,
    attribution: 'U.S. Geological Survey',
    note: `Latest gage height at monitoring stations in the Houston extent, observed within six hours; values retain USGS provisional/approved status. ${excluded} stale or unavailable observations excluded. Heights use each station's local reference and are not comparable across stations. Operational water-level context, not flood depth, flood likelihood, or a neighborhood safety score.`,
  };
}

/** Individual provider failures never become a successful empty replacement. */
export async function fetchCurrentFeeds(options: { now?: Date; fetch?: typeof globalThis.fetch } = {}): Promise<{
  feeds: LiveFeed[]; errors: { source_id: string; error: string }[];
}> {
  const now = (options.now ?? new Date()).getTime();
  if (!Number.isFinite(now)) throw new Error('Invalid current time.');
  const fetcher = options.fetch ?? globalThis.fetch;
  const sources = [ ['nws_alerts', alerts], ['usgs_gauges', gauges] ] as const;
  const results = await Promise.allSettled(sources.map(([, fetchSource]) => fetchSource(fetcher, now)));
  const feeds: LiveFeed[] = [], errors: { source_id: string; error: string }[] = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') feeds.push(result.value);
    else errors.push({ source_id: sources[i]![0], error: result.reason instanceof Error ? result.reason.message.slice(0, 300) : 'Provider request failed.' });
  });
  return { feeds, errors };
}

/** Apply again on every read: a stored payload is not an indefinitely live feed. */
export function getFreshFeed(feed: LiveFeed, now = new Date()): LiveFeed | null {
  const time = now.getTime();
  const checked = Date.parse(feed.source_checked_at);
  const published = Date.parse(feed.source_published_at ?? '');
  if (!Number.isFinite(time) || !Number.isFinite(Date.parse(feed.valid_until)) || Date.parse(feed.valid_until) <= time ||
      !Number.isFinite(checked) || checked > time + FUTURE_TOLERANCE || time - checked > SNAPSHOT_TTL ||
      !Number.isFinite(published) || published > time + FUTURE_TOLERANCE) return null;
  if (feed.source_id === 'nws_alerts' && time - published > SNAPSHOT_TTL) return null;
  const features = feed.payload.features.filter(feature => {
    const observed = Date.parse(String(feature.properties.time ?? ''));
    const expires = Date.parse(String(feature.properties.expires ?? ''));
    const valid = Date.parse(String(feature.properties.valid_until ?? ''));
    if (!Number.isFinite(valid) || valid <= time) return false;
    return feed.source_id === 'nws_alerts' ? Number.isFinite(expires) && expires > time :
      Number.isFinite(observed) && observed <= time + FUTURE_TOLERANCE && time - observed <= GAUGE_MAX_AGE;
  });
  if (feed.source_id === 'usgs_gauges' && !features.length) return null;
  return { ...feed, payload: { type: 'FeatureCollection', features }, record_count: features.length };
}
