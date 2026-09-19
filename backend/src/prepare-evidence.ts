import { createHash } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { createNeighborhoodClient, readBoundedJson, supabaseBaseUrl, type NeighborhoodProfile } from './neighborhoods.js';
import { REPORT_CATEGORIES } from './evidence.js';
import { validateEvidenceRows } from './publish-evidence.js';
import { fetchSource, prepareProfiles } from './import-neighborhoods.js';
import { verifyBoundarySnapshot } from './prepare-boundaries.js';

type Json = Record<string, unknown>;
type Point = [number, number];
const pointSchema = z.tuple([z.number().min(-96.5).max(-94.5), z.number().min(29).max(31)]);
const idSchema = z.number().int().min(1).max(88);
const timeSchema = z.iso.datetime({ offset: true });
const sourceSchema = z.object({ source_id: z.string(), category: z.string(), data_version: z.string(), boundary_version: z.string(),
  source_checked_at: timeSchema, published_count: z.number().int().min(0), source_url: z.url() }).passthrough();
const placeSchema = z.object({ place_id: z.string(), source_id: z.string(), category: z.string(), name: z.string(), address: z.string().nullable(),
  latitude: z.number().min(29).max(31), longitude: z.number().min(-96.5).max(-94.5), neighborhood_ids: z.array(idSchema), location_method: z.string() });
type Place = z.infer<typeof placeSchema>;
type Source = z.infer<typeof sourceSchema>;
type Boundary = { id: number; geometry: { type: 'MultiPolygon' | 'Polygon'; coordinates: unknown } };
export type EvidenceRow = {
  id: string; neighborhood_id: number; category_id: typeof REPORT_CATEGORIES[number];
  availability: 'partial' | 'reference_snapshot' | 'unavailable'; facts: Json; sources: Json[];
  missing_inputs: string[]; limitations: string[]; dependencies: Json[];
  boundary_version: string; evidence_version: string; prepared_at: string; refresh_due_at: string;
};

export function straightLineMeters(a: Point, b: Point): number {
  pointSchema.parse(a); pointSchema.parse(b);
  const rad = Math.PI / 180, dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  // Spherical great-circle distance, rounded to 10m; no road speeds or inferred minutes.
  return Math.round(6_371_008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h))) / 10) * 10;
}

// GeoJSON membership, including shared edges and excluding polygon-hole interiors.
function ringPosition(point: Point, ring: Point[]): 'inside' | 'outside' | 'boundary' {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j]!, b = ring[i]!;
    if (a[0] === b[0] && a[1] === b[1]) continue;
    const cross = (point[1] - a[1]) * (b[0] - a[0]) - (point[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(cross) < 1e-13 && point[0] >= Math.min(a[0], b[0]) && point[0] <= Math.max(a[0], b[0]) &&
      point[1] >= Math.min(a[1], b[1]) && point[1] <= Math.max(a[1], b[1])) return 'boundary';
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside ? 'inside' : 'outside';
}
export function coversPoint(point: Point, geometry: Boundary['geometry']): boolean {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates as Point[][]] : geometry.coordinates as Point[][][];
  return polygons.some(rings => {
    const outer = ringPosition(point, rings[0]!);
    if (outer === 'outside') return false;
    if (outer === 'boundary') return true;
    for (const ring of rings.slice(1)) {
      const pos = ringPosition(point, ring);
      if (pos === 'boundary') return true;
      if (pos === 'inside') return false;
    }
    return true;
  });
}

function inventoryFacts(profile: NeighborhoodProfile, categories: string[], places: Place[], sources: Source[]) {
  const center: Point = [profile.centroid_lon, profile.centroid_lat];
  return Object.fromEntries(categories.map(category => {
    const categorySources = sources.filter(s => s.category === category);
    const candidates = places.filter(p => p.category === category && categorySources.some(s => s.source_id === p.source_id));
    return [category, {
      record_count_in_neighborhood: categorySources.length ? candidates.filter(p => p.neighborhood_ids.includes(profile.neighborhood_id)).length : null,
      nearest_to_reference_point: categorySources.length ? candidates.map(p => ({ place_id: p.place_id, name: p.name, address: p.address,
        latitude: p.latitude, longitude: p.longitude, location_method: p.location_method,
        straight_line_meters: straightLineMeters(center, [p.longitude, p.latitude]),
        inside_neighborhood: p.neighborhood_ids.includes(profile.neighborhood_id), source_id: p.source_id,
      })).sort((a, b) => a.straight_line_meters - b.straight_line_meters || a.place_id.localeCompare(b.place_id)).slice(0, 3) : [],
      distance_method: 'spherical_great_circle_from_neighborhood_reference_point_rounded_10m',
    }];
  }));
}

const inventoryLimitations = [
  'Counts are source records, not necessarily distinct physical facilities; categories can overlap.',
  'Nearest records are chosen across imported Houston neighborhoods and may lie outside this neighborhood. Facilities outside the imported geography are not searched.',
  'Distances are straight-line from a neighborhood reference point, not a home, entrance, route, walking time or drive time. Parks use representative points.',
  'An inventory does not establish current opening status, admission eligibility, service quality or availability. Unknown observation dates remain unknown.',
];

export async function prepareEvidence(options: { url: string; publishableKey: string; fetch?: typeof fetch; now?: string }) {
  const base = supabaseBaseUrl(options.url), fetcher = options.fetch ?? fetch;
  const client = createNeighborhoodClient({ url: options.url, publishableKey: options.publishableKey, fetch: fetcher, cacheMs: 0 });
  async function table(name: 'neighborhood_sources' | 'neighborhood_places', order: string): Promise<unknown[]> {
    const result: unknown[] = [];
    for (let offset = 0; offset < 6_000; offset += 1_000) {
      const response = await fetcher(`${base}/rest/v1/${name}?select=*&order=${order}.asc&limit=1000&offset=${offset}`, {
        headers: { apikey: options.publishableKey }, redirect: 'error', signal: AbortSignal.timeout(30_000),
      });
      const batch = z.array(z.unknown()).max(1_000).parse(await readBoundedJson(response, 2_000_000));
      result.push(...batch); if (batch.length < 1_000) return result;
    }
    throw new Error('Inventory exceeds bounded read.');
  }
  const read = async (name: string) => JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), 'utf8'));
  const [profiles, sourceRaw, placeRaw, housing, groceries, anchors, flood, boundaryContent, boundaryManifest, economicSource, economicReference] = await Promise.all([
    client.list(), table('neighborhood_sources', 'source_id'), table('neighborhood_places', 'place_id'),
    read('neighborhood-housing.json'), read('neighborhood-groceries.json'), read('reference/destination-anchors.json'),
    read('neighborhood-flood-exposure.json'), readFile(new URL('../data/super-neighborhood-boundaries.geojson', import.meta.url), 'utf8'), read('super-neighborhood-boundaries.manifest.json'),
    fetchSource(fetcher), read('reference/super-neighborhoods-2024.json'),
  ]);
  const boundaries = verifyBoundarySnapshot(boundaryContent, boundaryManifest, profiles);
  const sources = z.array(sourceSchema).length(8).parse(sourceRaw), places = z.array(placeSchema).max(5_000).parse(placeRaw);
  const version: string = z.string().regex(/^coh-sn-boundaries-[a-f0-9]{16}$/).parse(boundaryManifest.boundary_version);
  if (new Set(places.map(p => p.place_id)).size !== places.length || new Set(sources.map(s => s.source_id)).size !== 8 ||
    sources.some(s => s.boundary_version !== version || places.filter(p => p.source_id === s.source_id).length !== s.published_count) ||
    places.some(p => !sources.some(s => s.source_id === p.source_id && s.category === p.category))) throw new Error('Incomplete or mismatched live inventory.');
  const ids = (rows: { neighborhood_id: number }[]) => rows.map(r => r.neighborhood_id).sort((a, b) => a - b).join(',');
  const expectedIds = profiles.map(p => p.neighborhood_id).join(',');
  if (ids(housing.rows) !== expectedIds || ids(flood.records) !== expectedIds || flood.boundary_version !== version ||
    boundaries.features.map((b: Boundary) => Number(b.id)).sort((a: number, b: number) => a - b).join(',') !== expectedIds) throw new Error('Incomplete enrichment neighborhood coverage.');
  if (housing.source_period_start !== 2020 || housing.source_period_end !== 2024) throw new Error('Housing edition changed: review contract.');
  if (anchors.destinations.map((d: Json) => d.id).sort().join(',') !== ['ion', 'downtown', 'energy', 'tmc', 'nasa', 'iah', 'hou'].sort().join(',')) throw new Error('Destination IDs changed.');
  const grocerySource = groceries.sources[0];
  if (groceries.sources.length !== 1 || grocerySource.source_id !== 'usda_snap_grocery' || groceries.features.length !== grocerySource.source_count ||
    groceries.features.length > 2_000 || new Set(groceries.features.map((f: Json) => f.id)).size !== groceries.features.length) throw new Error('Incomplete grocery source.');
  const groceryPlaces: Place[] = groceries.features.map((f: { id: string; geometry: { coordinates: Point }; properties: Json }) => {
    const coordinates = pointSchema.parse(f.geometry.coordinates);
    const neighborhoodIds = boundaries.features.filter((b: Boundary) => coversPoint(coordinates, b.geometry)).map((b: Boundary) => Number(b.id));
    return placeSchema.parse({ place_id: f.id, ...f.properties, longitude: coordinates[0], latitude: coordinates[1],
      location_method: 'source_point', neighborhood_ids: neighborhoodIds });
  }).filter((p: Place) => p.neighborhood_ids.length);
  const now = timeSchema.parse(options.now ?? new Date().toISOString());
  // Recheck the fixed City endpoint even when the existing content/version is unchanged.
  // Original retrieval dates remain provenance, never the deadline for all future refreshes.
  const checkedProfiles = prepareProfiles(economicSource, economicReference, now);
  if (checkedProfiles[0]!.data_version !== profiles[0]!.data_version) throw new Error('Economic source changed; publish the reviewed profile edition before evidence.');
  const housingCheckTimes = housing.sources.map((s: Json) => timeSchema.parse(s.source_retrieved_at));
  const allSourceTimes = [...housingCheckTimes, flood.source_checked_at, anchors.checked_at, grocerySource.source_checked_at, ...sources.map(s => s.source_checked_at)];
  for (const time of allSourceTimes) {
    timeSchema.parse(time);
    if (Date.parse(time) > Date.parse(now) + 300_000 || Date.parse(now) - Date.parse(time) > 31 * 86_400_000) throw new Error('Refresh source snapshots before preparing evidence.');
  }
  const rows: EvidenceRow[] = [];
  for (const profile of profiles) {
    const row = (category: EvidenceRow['category_id'], facts: Json, rowSources: Json[], missing: string[], limitations: string[], deps: Json[] = [], sourceTimes: string[] = [now]): EvidenceRow => ({
      id: `evidence:${profile.neighborhood_id}:${category}`, neighborhood_id: profile.neighborhood_id, category_id: category,
      availability: Object.keys(facts).length ? 'partial' : 'unavailable', facts,
      sources: rowSources.map(s => ({ ...s, source_checked_at: s.source_checked_at ?? s.source_retrieved_at,
        source_period: s.source_period ?? (s.source_period_start && s.source_period_end ? `ACS ${s.source_period_start}-${s.source_period_end}` : null) })),
      missing_inputs: missing, limitations,
      dependencies: [{ kind: 'profile', version: profile.data_version }, ...deps.filter(d => d.kind !== 'profile')],
      boundary_version: version, evidence_version: '', prepared_at: now,
      refresh_due_at: new Date(Math.min(...sourceTimes.map(Date.parse)) + 31 * 86_400_000).toISOString(),
    });
    const h = housing.rows.find((r: Json) => r.neighborhood_id === profile.neighborhood_id);
    rows.push(row('afford', {
      median_gross_rent_monthly_usd: profile.median_gross_rent, median_home_value_usd: profile.median_home_value,
      housing_stock: h.facts, quality_flags: [...profile.quality_flags, ...h.quality_flags], housing_table_audit: h.audit,
    }, [{ source_id: 'coh_economic_profile', source_url: profile.source_url, source_period: 'ACS 2020-2024',
      source_checked_at: now, source_retrieved_at: profile.source_retrieved_at, data_version: profile.data_version }, ...housing.sources],
    ['Candidate budget, tenure, housing preferences, salary and offer/remote mode', 'Current comparable listings and all-in ownership/rental costs', 'Origin-city and tax inputs for a relocation financial comparison',
      ...(profile.median_gross_rent === null ? ['Neighborhood median rent is unavailable'] : [])],
    ['Gross rent is a monthly ACS estimate and home value is an estimated median, not a current asking price or mortgage payment.', ...housing.interpretation],
    [{ kind: 'profile', version: profile.data_version }], [...housingCheckTimes, now]));
    for (const [category, categories, missing] of [
      ['amen', ['libraries', 'museums', 'community_centers', 'multi_service_centers'], ['Operating hours and candidate-specific amenity preferences']],
      ['fit', ['parks', 'community_centers'], ['Verified gyms, trails, facility entrances and usable walking/cycling routes']],
      ['health', ['hospitals', 'health_facilities', 'multi_service_centers'], ['Insurance acceptance, specialties, appointments, emergency capacity and road travel time']],
    ] as const) {
      const selectedSources = sources.filter(s => (categories as readonly string[]).includes(s.category));
      rows.push(row(category, { inventories: inventoryFacts(profile, [...categories], places, selectedSources) }, selectedSources,
        [...missing], inventoryLimitations, selectedSources.map(s => ({ kind: 'places', source_id: s.source_id, version: s.data_version })), selectedSources.map(s => s.source_checked_at)));
    }
    rows.push(row('food', { inventories: inventoryFacts(profile, ['grocery_stores'], groceryPlaces,
      [{ ...grocerySource, data_version: 'snap-local', boundary_version: version, published_count: groceryPlaces.length }]) }, [grocerySource],
    ['Verified restaurant/dining inventory', 'Grocery stores outside the SNAP-authorized subset', 'Opening hours, prices, stock, dietary fit and road travel time'],
    [grocerySource.note, ...inventoryLimitations], [], [grocerySource.source_checked_at]));
    for (const category of ['commute', 'air'] as const) {
      const destinations = anchors.destinations.filter((d: Json) => d.kind === (category === 'commute' ? 'office_hub' : 'airport'));
      rows.push(row(category, { destinations: destinations.map((d: Json) => ({ ...d,
        straight_line_meters: straightLineMeters([profile.centroid_lon, profile.centroid_lat], pointSchema.parse(d.coordinates)), drive_time_minutes: null,
      })), route_status: 'not_configured' }, destinations.map((d: Json) => ({ source_id: `destination_${d.id}`, source_url: d.source_url,
        source_checked_at: anchors.checked_at, location_method: d.location_method, geocoder: anchors.geocoder })),
      category === 'commute' ? ['Verified origin/destination route and departure time', 'In-office frequency and commute reliability data'] : ['Terminal-specific route and departure time', 'Current airline/route schedules if used in a recommendation'],
      [anchors.use, 'A road-routing provider with appropriate terms and credentials is required before returning drive-time minutes.'], [], [anchors.checked_at]));
    }
    const f = flood.records.find((r: Json) => r.neighborhood_id === profile.neighborhood_id);
    const { neighborhood_id: ignoredId, name: ignoredName, boundary_version: ignoredVersion, ...floodFacts } = f;
    rows.push(row('flood', { ...floodFacts, definitions: flood.definitions }, [{ source_id: flood.source_id, source_url: flood.source_url,
      source_checked_at: flood.source_checked_at, source_period: flood.source_period, source_version: flood.source_version,
      coordinate_area_method: flood.coordinate_area_method, coverage_threshold_pct: flood.coverage_threshold_pct,
      source_layers: flood.source_layers }],
    ['Property-specific flood assessment, drainage and insurance', ...(f.availability !== 'reference_summary' ? ['Complete classified/effective map coverage; exposure shares are withheld'] : [])],
    flood.limitations, [], [flood.source_checked_at]));
  }
  // Detect a concurrent inventory/profile publication rather than mixing versions.
  const afterSources = z.array(sourceSchema).parse(await table('neighborhood_sources', 'source_id'));
  const afterProfiles = await client.list();
  if (JSON.stringify(afterSources) !== JSON.stringify(sources) || JSON.stringify(afterProfiles) !== JSON.stringify(profiles)) throw new Error('Live source changed during preparation. Retry with one source edition.');
  const evidenceVersion = `report-evidence-${createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16)}`;
  for (const r of rows) r.evidence_version = evidenceVersion;
  if (rows.length !== 704 || new Set(rows.map(r => r.id)).size !== 704) throw new Error('Expected all 88 x 8 category records.');
  validateEvidenceRows(rows);
  return { schema_version: 1, profile_id: 'report-priorities-v1', evidence_version: evidenceVersion, prepared_at: now,
    boundary_version: version, summary: { neighborhoods: 88, category_rows: rows.length, grocery_source_records: groceries.features.length,
      grocery_records_in_neighborhoods: groceryPlaces.length }, rows };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await prepareEvidence({ url: process.env.SUPABASE_URL ?? '', publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '' });
    const destination = new URL('../data/neighborhood-evidence.json', import.meta.url), temporary = new URL('../data/neighborhood-evidence.json.tmp', import.meta.url);
    await writeFile(temporary, JSON.stringify(result) + '\n'); await rename(temporary, destination);
    console.log(JSON.stringify({ ...result.summary, evidence_version: result.evidence_version }));
  } catch (error) { console.error(error instanceof Error ? error.message : 'Evidence preparation failed.'); process.exitCode = 1; }
}
