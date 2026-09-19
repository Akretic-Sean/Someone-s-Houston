import { readFile, writeFile, rename } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

export const MAX_SOURCE_ROWS = 5_000;
export const MAX_SOURCE_BYTES = 15_000_000;
const field = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const sourceSchema = z.object({
  source_id: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  category: z.enum(['parks', 'libraries', 'community_centers', 'hospitals', 'health_facilities', 'multi_service_centers', 'museums', 'schools']),
  source_url: z.url().refine(value => /^https:\/\/(mycity2\.houstontx\.gov\/gisweb01\/rest\/services\/HoustonMap\/Neighborhood\/MapServer\/\d+|services2\.arcgis\.com\/5MVN2jsqIrNZD4tP\/arcgis\/rest\/services\/Schools_2024_to_2025\/FeatureServer\/0)$/.test(value), 'Use a reviewed official source endpoint.'),
  object_id_field: field, name_field: field, address_fields: z.array(field).max(10),
  geometry_type: z.enum(['Point', 'Polygon']),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  expected_data_last_edit: z.number().int().positive().optional(),
  source_published_at: z.iso.datetime({ offset: true }).nullable(),
  source_period: z.string().max(100).nullable(),
  attribution: z.string().min(1).max(250), note: z.string().min(1).max(2_000),
}).strict();
export type AmenitySourceConfig = z.infer<typeof sourceSchema>;

export function validateAmenitySources(input: unknown): AmenitySourceConfig[] {
  const configs = z.object({ sources: z.array(sourceSchema).min(1).max(20) }).strict().parse(input).sources;
  if (new Set(configs.map(c => c.source_id)).size !== configs.length) throw new Error('Duplicate amenity source IDs.');
  for (const c of configs) {
    if (c.bbox && (c.bbox[0] >= c.bbox[2] || c.bbox[1] >= c.bbox[3] || c.bbox[0] < -180 || c.bbox[2] > 180 || c.bbox[1] < -90 || c.bbox[3] > 90)) throw new Error('Invalid source bounding box.');
  }
  return configs;
}

// Regional bound detects accidentally projected coordinates without rounding geometry.
const position = z.tuple([z.number().finite().min(-97.5).max(-94), z.number().finite().min(28).max(31.5)]);
const ring = z.array(position).min(4).max(500_000).refine(points => {
  const first = points[0]!, last = points[points.length - 1]!;
  return first[0] === last[0] && first[1] === last[1];
}, 'Polygon ring is not closed.');
const geometrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Point'), coordinates: position }),
  z.object({ type: z.literal('Polygon'), coordinates: z.array(ring).min(1).max(1_000) }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(ring).min(1).max(1_000)).min(1).max(1_000) }),
]);
export type AmenityGeometry = z.infer<typeof geometrySchema>;
export interface AmenityFeature {
  type: 'Feature'; id: string;
  properties: { source_id: string; source_object_id: string; category: string; name: string; address: string | null };
  geometry: AmenityGeometry;
}
export interface AmenitySource {
  source_id: string; category: string; source_url: string; source_checked_at: string;
  source_published_at: string | null; source_period: string | null; source_count: number;
  attribution: string; note: string;
}
export interface AmenitySnapshot { sources: AmenitySource[]; features: AmenityFeature[] }

const metadataSchema = z.object({
  geometryType: z.enum(['esriGeometryPoint', 'esriGeometryPolygon']),
  maxRecordCount: z.number().int().positive(),
  fields: z.array(z.object({ name: z.string(), type: z.string() })),
  editingInfo: z.object({ dataLastEditDate: z.number().optional() }).nullish(),
  uniqueIdInfo: z.object({ OIDFieldContainsHashValue: z.boolean().optional() }).optional(),
});
const idListSchema = z.object({ objectIdFieldName: z.string(), objectIds: z.array(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)).max(MAX_SOURCE_ROWS) });
const rawFeatureSchema = z.object({ type: z.literal('Feature'), properties: z.record(z.string(), z.unknown()), geometry: geometrySchema });
const collectionSchema = z.object({ type: z.literal('FeatureCollection'), features: z.array(rawFeatureSchema).max(MAX_SOURCE_ROWS), exceededTransferLimit: z.boolean().optional() });

/** Projects only selected public fields; geometry always comes from outSR=4326. */
export function normalizeAmenityFeature(input: unknown, config: AmenitySourceConfig): AmenityFeature {
  const feature = rawFeatureSchema.parse(input);
  const oid = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(feature.properties[config.object_id_field]);
  const name = z.string().trim().min(1).max(500).parse(feature.properties[config.name_field]);
  if ((config.geometry_type === 'Point') !== (feature.geometry.type === 'Point')) throw new Error(`Unexpected geometry for ${config.source_id}.`);
  const address = config.address_fields.map(key => z.string().nullable().optional().parse(feature.properties[key])?.trim() ?? '').filter(Boolean).join(' ') || null;
  if (address && address.length > 1_000) throw new Error('Amenity address is too long.');
  return {
    type: 'Feature', id: `${config.source_id}:${oid}`,
    properties: { source_id: config.source_id, source_object_id: String(oid), category: config.category, name, address },
    geometry: feature.geometry,
  };
}

/** Fetches complete ID batches with a cumulative byte cap across every source request. */
export async function fetchAmenitySource(configInput: AmenitySourceConfig, options: { fetch?: typeof globalThis.fetch; checkedAt?: string; maxBytes?: number; pageSize?: number } = {}): Promise<AmenitySnapshot> {
  const config = sourceSchema.parse(configInput);
  const fetcher = options.fetch ?? globalThis.fetch;
  const checkedAt = z.iso.datetime({ offset: true }).parse(options.checkedAt ?? new Date().toISOString());
  const maxBytes = z.number().int().positive().max(MAX_SOURCE_BYTES).parse(options.maxBytes ?? MAX_SOURCE_BYTES);
  let consumed = 0;
  async function get(path: string, params: Record<string, string>): Promise<unknown> {
    const encoded = new URLSearchParams(params).toString();
    const url = `${config.source_url}${path}?${encoded}`;
    // ArcGIS query is read-only; POST avoids gateway URL limits for ID batches.
    const response = await fetcher(url.length > 1_800 ? `${config.source_url}${path}` : url, {
      ...(url.length > 1_800 ? { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: encoded } : {}),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error(`${config.source_id}: source request failed (HTTP ${response.status}).`);
    if (!response.body) throw new Error('Source response has no body.');
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        consumed += value.byteLength;
        if (consumed > maxBytes) throw new Error(`${config.source_id}: cumulative source size limit exceeded.`);
        size += value.byteLength; chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const raw: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof raw === 'object' && raw !== null && 'error' in raw) throw new Error(`${config.source_id}: ArcGIS returned a source error.`);
    return raw;
  }
  const meta = metadataSchema.parse(await get('', { f: 'json' }));
  const selected = [...new Set([config.object_id_field, config.name_field, ...config.address_fields])];
  if (selected.some(name => !meta.fields.some(f => f.name === name)) || !meta.fields.some(f => f.name === config.object_id_field && f.type === 'esriFieldTypeOID')) throw new Error(`${config.source_id}: selected source fields changed.`);
  if (meta.geometryType !== `esriGeometry${config.geometry_type}`) throw new Error('Source geometry type changed.');
  if (meta.uniqueIdInfo?.OIDFieldContainsHashValue) throw new Error('Source IDs are generated hashes and cannot be used as stable feature IDs.');
  if (config.expected_data_last_edit !== undefined && meta.editingInfo?.dataLastEditDate !== config.expected_data_last_edit) throw new Error(`${config.source_id}: source edition changed; review its period before publishing.`);
  const query: Record<string, string> = { f: 'json', where: '1=1' };
  if (config.bbox) Object.assign(query, { geometry: config.bbox.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' });
  const count = z.object({ count: z.number().int().min(1).max(MAX_SOURCE_ROWS) }).parse(await get('/query', { ...query, returnCountOnly: 'true' })).count;
  async function getIds() {
    const result = idListSchema.parse(await get('/query', { ...query, returnIdsOnly: 'true' }));
    if (result.objectIdFieldName !== config.object_id_field || result.objectIds.length !== count || new Set(result.objectIds).size !== count) throw new Error('Source ID inventory is incomplete, duplicated, or changed.');
    return result.objectIds.sort((a, b) => a - b);
  }
  const ids = await getIds();
  const pageSize = Math.min(meta.maxRecordCount, z.number().int().positive().max(1_000).parse(options.pageSize ?? 500));
  const features: AmenityFeature[] = [];
  for (let offset = 0; offset < ids.length; offset += pageSize) {
    const requestedIds = ids.slice(offset, offset + pageSize);
    const page = collectionSchema.parse(await get('/query', {
      ...query, f: 'geojson', objectIds: requestedIds.join(','), outFields: selected.join(','),
      returnGeometry: 'true', outSR: '4326', returnZ: 'false', returnM: 'false',
      orderByFields: config.object_id_field, resultRecordCount: String(pageSize),
    }));
    if (page.exceededTransferLimit || page.features.length !== requestedIds.length) throw new Error('Source feature batch is incomplete.');
    const batch = page.features.map(feature => normalizeAmenityFeature(feature, config));
    const returnedIds = batch.map(f => Number(f.properties.source_object_id)).sort((a, b) => a - b);
    if (JSON.stringify(returnedIds) !== JSON.stringify(requestedIds)) throw new Error('Source feature IDs are missing, duplicated, or unexpected.');
    features.push(...batch);
  }
  if (JSON.stringify(await getIds()) !== JSON.stringify(ids)) throw new Error('Source ID inventory changed during retrieval; retry.');
  if (meta.editingInfo?.dataLastEditDate !== undefined) {
    const after = metadataSchema.parse(await get('', { f: 'json' }));
    if (after.editingInfo?.dataLastEditDate !== meta.editingInfo.dataLastEditDate) throw new Error('Source data changed during retrieval; retry.');
  }
  const { source_id, category, source_url, source_published_at, source_period, attribution, note } = config;
  return { sources: [{ source_id, category, source_url, source_checked_at: checkedAt, source_published_at, source_period, source_count: count, attribution, note }], features: features.sort((a, b) => Number(a.properties.source_object_id) - Number(b.properties.source_object_id)) };
}

async function main() {
  if (process.argv.length > 2) throw new Error('Usage: prepare-amenities.js');
  const configs = validateAmenitySources(JSON.parse(await readFile(new URL('../data/reference/amenity-sources.json', import.meta.url), 'utf8')));
  const snapshot: AmenitySnapshot = { sources: [], features: [] };
  const checkedAt = new Date().toISOString();
  for (const config of configs) {
    const source = await fetchAmenitySource(config, { checkedAt });
    snapshot.sources.push(...source.sources); snapshot.features.push(...source.features);
    console.log(JSON.stringify({ source_id: config.source_id, source_count: source.features.length, source_period: config.source_period }));
  }
  // Failed source fetch/validation leaves the last complete snapshot untouched.
  const destination = new URL('../data/neighborhood-amenities.json', import.meta.url);
  const temporary = new URL('../data/neighborhood-amenities.json.tmp', import.meta.url);
  const content = JSON.stringify(snapshot) + '\n';
  await writeFile(temporary, content);
  await rename(temporary, destination);
  console.log(JSON.stringify({ status: 'prepared', sources: snapshot.sources.length, features: snapshot.features.length, json_bytes: Buffer.byteLength(content) }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'Amenity preparation failed.'); process.exitCode = 1; });
}
