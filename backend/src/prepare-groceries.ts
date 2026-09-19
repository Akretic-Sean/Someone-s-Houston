import { writeFile, rename } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { AmenityFeature, AmenitySnapshot } from './prepare-amenities.js';

export const GROCERY_SOURCE_URL = 'https://services1.arcgis.com/RLQu0rK7h4kbsBq5/arcgis/rest/services/snap_retailer_location_data/FeatureServer/0';
export const GROCERY_TYPES = ['Grocery Store', 'Supermarket', 'Super Store'] as const;
const BBOX = [-95.90, 29.50, -95.00, 30.20] as const;
const SOURCE_ID = 'usda_snap_grocery';
const MAX_ROWS = 2_000;
const MAX_BYTES = 5_000_000;
const fields = ['ObjectId', 'Record_ID', 'Store_Name', 'Store_Type', 'Store_Street_Address', 'City', 'State', 'Zip_Code', 'Latitude', 'Longitude'];
const metadataSchema = z.object({
  objectIdField: z.literal('ObjectId'), geometryType: z.literal('esriGeometryPoint'),
  maxRecordCount: z.number().int().positive(),
  fields: z.array(z.object({ name: z.string(), type: z.string() })),
  editingInfo: z.object({ dataLastEditDate: z.number().int().positive() }),
});
const rawFeatureSchema = z.object({
  attributes: z.object({
    ObjectId: z.number().int().positive(), Record_ID: z.number().int().positive(),
    Store_Name: z.string().trim().min(1).max(500), Store_Type: z.enum(GROCERY_TYPES),
    Store_Street_Address: z.string().trim().min(1).max(500),
    City: z.string().trim().min(1).max(100), State: z.literal('TX'), Zip_Code: z.string().regex(/^\d{5}$/),
    Latitude: z.number().min(BBOX[1]).max(BBOX[3]), Longitude: z.number().min(BBOX[0]).max(BBOX[2]),
  }),
  geometry: z.object({ x: z.number().min(BBOX[0]).max(BBOX[2]), y: z.number().min(BBOX[1]).max(BBOX[3]) }),
});

/** SNAP authorization is the scope of this inventory, not a store quality or completeness claim. */
export function normalizeGrocery(input: unknown): AmenityFeature {
  const { attributes: row, geometry } = rawFeatureSchema.parse(input);
  if (Math.abs(row.Longitude - geometry.x) > 0.00001 || Math.abs(row.Latitude - geometry.y) > 0.00001) throw new Error('USDA coordinate fields disagree with geometry.');
  return {
    type: 'Feature', id: `${SOURCE_ID}:${row.Record_ID}`,
    properties: {
      source_id: SOURCE_ID, source_object_id: String(row.Record_ID), category: 'grocery_stores',
      name: row.Store_Name, address: `${row.Store_Street_Address}, ${row.City}, ${row.State} ${row.Zip_Code}`,
    },
    geometry: { type: 'Point', coordinates: [geometry.x, geometry.y] },
  };
}

/** One regional query and complete bounded ID batches. City membership is assigned in PostGIS. */
export async function fetchGroceries(options: { fetch?: typeof globalThis.fetch; checkedAt?: string; maxBytes?: number } = {}): Promise<AmenitySnapshot> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const checkedAt = z.iso.datetime({ offset: true }).parse(options.checkedAt ?? new Date().toISOString());
  const maxBytes = z.number().int().positive().max(MAX_BYTES).parse(options.maxBytes ?? MAX_BYTES);
  let consumed = 0;
  async function get(path: string, params: Record<string, string>): Promise<unknown> {
    const encoded = new URLSearchParams(params).toString();
    const url = `${GROCERY_SOURCE_URL}${path}?${encoded}`;
    const response = await fetcher(url.length > 1_800 ? `${GROCERY_SOURCE_URL}${path}` : url, {
      ...(url.length > 1_800 ? { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: encoded } : {}),
      signal: AbortSignal.timeout(30_000), redirect: 'error',
    });
    if (!response.ok || !response.body) throw new Error(`USDA request failed (HTTP ${response.status}).`);
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        consumed += value.byteLength;
        if (consumed > maxBytes) throw new Error('USDA cumulative response limit exceeded.');
        size += value.byteLength; chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const raw: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof raw === 'object' && raw !== null && 'error' in raw) throw new Error('USDA ArcGIS query returned an error.');
    return raw;
  }
  const meta = metadataSchema.parse(await get('', { f: 'json' }));
  if (fields.some(name => !meta.fields.some(f => f.name === name)) || !meta.fields.some(f => f.name === 'ObjectId' && f.type === 'esriFieldTypeOID')) throw new Error('USDA source fields changed.');
  if (meta.editingInfo.dataLastEditDate > Date.parse(checkedAt) + 300_000) throw new Error('USDA source edition is unexpectedly in the future.');
  const query: Record<string, string> = {
    f: 'json', where: `Store_Type IN (${GROCERY_TYPES.map(t => `'${t}'`).join(',')})`,
    geometry: BBOX.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
  };
  const count = z.object({ count: z.number().int().min(1).max(MAX_ROWS) }).parse(await get('/query', { ...query, returnCountOnly: 'true' })).count;
  async function ids() {
    const list = z.object({ objectIdFieldName: z.literal('ObjectId'), objectIds: z.array(z.number().int().positive()).max(MAX_ROWS) }).parse(await get('/query', { ...query, returnIdsOnly: 'true' })).objectIds;
    if (list.length !== count || new Set(list).size !== count) throw new Error('USDA ID inventory is incomplete or duplicated.');
    return list.sort((a, b) => a - b);
  }
  const before = await ids(), features: AmenityFeature[] = [];
  const batchSize = Math.min(100, meta.maxRecordCount);
  for (let i = 0; i < before.length; i += batchSize) {
    const requested = before.slice(i, i + batchSize);
    const page = z.object({ features: z.array(rawFeatureSchema).max(MAX_ROWS), exceededTransferLimit: z.boolean().optional() }).parse(await get('/query', {
      ...query, objectIds: requested.join(','), outFields: fields.join(','), returnGeometry: 'true', outSR: '4326', resultRecordCount: String(batchSize), orderByFields: 'ObjectId',
    }));
    if (page.exceededTransferLimit || JSON.stringify(page.features.map(f => f.attributes.ObjectId).sort((a, b) => a - b)) !== JSON.stringify(requested)) throw new Error('USDA batch is incomplete or mismatched.');
    features.push(...page.features.map(normalizeGrocery));
  }
  if (new Set(features.map(f => f.id)).size !== features.length) throw new Error('USDA retailer IDs are duplicated.');
  if (JSON.stringify(await ids()) !== JSON.stringify(before) || metadataSchema.parse(await get('', { f: 'json' })).editingInfo.dataLastEditDate !== meta.editingInfo.dataLastEditDate) throw new Error('USDA inventory changed during retrieval; retry.');
  const edition = new Date(meta.editingInfo.dataLastEditDate).toISOString();
  return {
    sources: [{ source_id: SOURCE_ID, category: 'grocery_stores', source_url: GROCERY_SOURCE_URL,
      source_checked_at: checkedAt, source_published_at: edition, source_period: `USDA inventory layer edited ${edition.slice(0, 10)}`,
      source_count: features.length, attribution: 'USDA Food and Nutrition Administration — SNAP Retailer Locator',
      note: 'Only SNAP-authorized retailers classified by USDA as Grocery Store, Supermarket or Super Store. Regional bounding-box inventory is filtered to Houston Super Neighborhoods during publication. This subset is not a census of all grocery stores, dining options, affordability, quality, current opening hours or stock. The layer edit date is the inventory edition, not an individual store inspection or opening date. Source Record_ID identifies retailers; ObjectId is used only for retrieval batches. Official provenance: https://www.fna.usda.gov/snap/retailer-locator ; https://www.arcgis.com/home/item.html?id=8b260f9a10b0459aa441ad8588c2251c' }],
    features: features.sort((a, b) => Number(a.properties.source_object_id) - Number(b.properties.source_object_id)),
  };
}

async function main() {
  if (process.argv.length > 2) throw new Error('Usage: prepare-groceries.js');
  const snapshot = await fetchGroceries();
  const target = new URL('../data/neighborhood-groceries.json', import.meta.url);
  const temporary = new URL(`${target.href}.tmp`);
  await writeFile(temporary, `${JSON.stringify(snapshot)}\n`, 'utf8');
  await rename(temporary, target);
  console.log(JSON.stringify({ source: SOURCE_ID, rows: snapshot.features.length, edition: snapshot.sources[0]!.source_published_at }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
