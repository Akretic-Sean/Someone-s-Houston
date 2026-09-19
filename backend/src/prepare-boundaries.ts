import { createHash } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { SOURCE_URL, readBoundedJson, validateProfiles } from './neighborhoods.js';

const positionSchema = z.tuple([z.number().finite().min(-96.5).max(-94.5), z.number().finite().min(29).max(31)]);
const ringSchema = z.array(positionSchema).min(4).max(100_000);
const polygonSchema = z.array(ringSchema).min(1).max(1_000);
const geometrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Polygon'), coordinates: polygonSchema }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(polygonSchema).min(1).max(1_000) }),
]);
export type BoundaryGeometry = z.infer<typeof geometrySchema>;
type Position = z.infer<typeof positionSchema>;

const rawSchema = z.object({
  type: z.literal('FeatureCollection'),
  crs: z.object({ type: z.literal('name'), properties: z.object({ name: z.literal('EPSG:4326') }) }).optional(),
  exceededTransferLimit: z.boolean().optional(),
  features: z.array(z.object({
    type: z.literal('Feature'),
    properties: z.object({ POLYID: z.number().int().min(1).max(88), SNBNAME: z.string().min(1).max(120) }),
    geometry: geometrySchema,
  })).length(88),
});
const referenceSchema = z.array(z.object({ neighborhood_id: z.number().int().min(1).max(88), name: z.string() })).length(88);

function normalizeRing(ring: Position[], exterior: boolean): Position[] {
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) throw new Error('Boundary ring is not closed.');
  // Translate around the first vertex to avoid cancellation with large longitude values.
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    area += (a[0] - first[0]) * (b[1] - first[1]) - (b[0] - first[0]) * (a[1] - first[1]);
  }
  if (Math.abs(area) < 1e-14) throw new Error('Boundary ring has zero area.');
  // RFC 7946: outer rings counterclockwise, holes clockwise. No vertex rounding/simplification.
  return (area > 0) === exterior ? ring : [...ring].reverse();
}

export function prepareBoundaries(input: unknown, referenceInput: unknown) {
  const source = rawSchema.parse(input);
  if (source.exceededTransferLimit) throw new Error('ArcGIS boundary response is incomplete.');
  const reference = referenceSchema.parse(referenceInput);
  if (new Set(reference.map(r => r.neighborhood_id)).size !== 88) throw new Error('Duplicate profile IDs.');
  if (new Set(source.features.map(f => f.properties.POLYID)).size !== 88) throw new Error('Duplicate boundary IDs.');
  let positionCount = 0;
  const features = source.features.map(feature => {
    const id = feature.properties.POLYID;
    if (reference.find(r => r.neighborhood_id === id)?.name !== feature.properties.SNBNAME) {
      throw new Error(`Boundary ${id} does not match the current profile name. Review the source release.`);
    }
    const normalizePolygon = (polygon: Position[][]) => polygon.map((ring, index) => {
      positionCount += ring.length;
      if (positionCount > 250_000) throw new Error('Boundary dataset exceeds the position limit.');
      return normalizeRing(ring, index === 0);
    });
    const geometry: BoundaryGeometry = feature.geometry.type === 'Polygon'
      ? { type: 'Polygon', coordinates: normalizePolygon(feature.geometry.coordinates) }
      : { type: 'MultiPolygon', coordinates: feature.geometry.coordinates.map(normalizePolygon) };
    return { type: 'Feature' as const, id, properties: { neighborhood_id: id, name: feature.properties.SNBNAME }, geometry };
  }).sort((a, b) => a.id - b.id);
  const version = `coh-sn-boundaries-${createHash('sha256').update(JSON.stringify(features)).digest('hex').slice(0, 16)}`;
  const collection = {
    type: 'FeatureCollection' as const,
    features: features.map(f => ({ ...f, properties: { ...f.properties, boundary_version: version } })),
  };
  return { collection, boundaryVersion: version, positionCount };
}

export async function fetchBoundarySource(fetcher = globalThis.fetch) {
  const params = new URLSearchParams({ f: 'geojson', where: '1=1', outFields: 'POLYID,SNBNAME', outSR: '4326', returnGeometry: 'true', orderByFields: 'POLYID', resultRecordCount: '89' });
  const request = async (url: string, maxBytes: number, timeout: number) =>
    readBoundedJson(await fetcher(url, { signal: AbortSignal.timeout(timeout) }), maxBytes);
  const [source, metadata] = await Promise.all([
    request(`${SOURCE_URL}/query?${params}`, 10_000_000, 45_000),
    request(`${SOURCE_URL}?f=json`, 1_000_000, 30_000),
  ]);
  return { source, metadata };
}

async function main() {
  if (process.argv.length > 2) throw new Error('Usage: prepare-boundaries.js');
  const profiles = validateProfiles(JSON.parse(await readFile(new URL('../data/super-neighborhoods.json', import.meta.url), 'utf8')));
  const { source, metadata } = await fetchBoundarySource();
  const prepared = prepareBoundaries(source, profiles);
  const info = z.object({ editingInfo: z.object({
    dataLastEditDate: z.number().int().positive(), schemaLastEditDate: z.number().int().positive(),
  }) }).parse(metadata);
  const content = JSON.stringify(prepared.collection) + '\n';
  const manifest = {
    source_url: SOURCE_URL,
    source_checked_at: new Date().toISOString(),
    source_data_last_edit_at: new Date(info.editingInfo.dataLastEditDate).toISOString(),
    source_schema_last_edit_at: new Date(info.editingInfo.schemaLastEditDate).toISOString(),
    source_boundary_effective_date: null,
    source_date_note: 'ArcGIS edit timestamps describe the service, not when neighborhood boundaries took effect. No boundary effective date is published in the layer metadata.',
    coordinate_reference_system: 'EPSG:4326',
    coordinate_order: 'longitude,latitude',
    boundary_version: prepared.boundaryVersion,
    sha256: createHash('sha256').update(content).digest('hex'),
    feature_count: prepared.collection.features.length,
    position_count: prepared.positionCount,
    json_bytes: Buffer.byteLength(content),
    simplification: 'None; source coordinate precision retained. Ring direction normalized to RFC 7946.',
    validation: 'IDs and names match all 88 existing profiles; finite coordinates in Houston bounds, closed nonzero-area rings. Database publication must also pass PostGIS ST_IsValid for every geometry.',
  };
  const destination = new URL('../data/super-neighborhood-boundaries.geojson', import.meta.url);
  let changed = true;
  try { changed = await readFile(destination, 'utf8') !== content; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (changed) {
    const temporary = new URL('../data/super-neighborhood-boundaries.geojson.tmp', import.meta.url);
    await writeFile(temporary, content);
    await rename(temporary, destination);
  }
  const manifestTemporary = new URL('../data/super-neighborhood-boundaries.manifest.json.tmp', import.meta.url);
  await writeFile(manifestTemporary, JSON.stringify(manifest, null, 2) + '\n');
  await rename(manifestTemporary, new URL('../data/super-neighborhood-boundaries.manifest.json', import.meta.url));
  console.log(JSON.stringify({ status: changed ? 'prepared' : 'unchanged', ...manifest }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'Boundary preparation failed.'); process.exitCode = 1; });
}
