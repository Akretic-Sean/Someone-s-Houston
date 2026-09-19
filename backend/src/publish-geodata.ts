import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { readBoundedJson, supabaseBaseUrl } from './neighborhoods.js';

export interface GeoFeature { type: string; id: string | number; properties: Record<string, unknown>; geometry: unknown }
export interface SourceManifest {
  source_id: string; category: string; source_count: number; source_url: string;
  source_checked_at: string; source_published_at: string | null; source_period: string | null;
  attribution: string; note: string;
}

const MAX_BATCH_BYTES = 1_900_000; // Leaves room for the RPC envelope below the database's 2MB limit.

function validateFeature(feature: GeoFeature): void {
  const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
  if (!record(feature) || feature.type !== 'Feature' ||
      !(typeof feature.id === 'string' ? feature.id.trim().length > 0 && feature.id.length <= 200 : Number.isSafeInteger(feature.id)) ||
      !record(feature.properties) || !record(feature.geometry)) throw new Error('Malformed GeoJSON feature.');
  const point = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 && value.every(n => typeof n === 'number' && Number.isFinite(n)) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
  const polygon = (value: unknown): boolean => Array.isArray(value) && value.length > 0 && value.every(ring =>
    Array.isArray(ring) && ring.length >= 4 && ring.every(point) && ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1]);
  const { type, coordinates } = feature.geometry;
  if (!(type === 'Point' ? point(coordinates) : type === 'Polygon' ? polygon(coordinates) :
      type === 'MultiPolygon' && Array.isArray(coordinates) && coordinates.length > 0 && coordinates.every(polygon))) {
    throw new Error('Malformed or unsupported GeoJSON geometry.');
  }
}

export function featureBatches(features: GeoFeature[], maxBytes = 80_000, maxRows = 100): GeoFeature[][] {
  if (!Array.isArray(features) || !Number.isInteger(maxRows) || maxRows < 1 || maxRows > 100 ||
      !Number.isInteger(maxBytes) || maxBytes < 1000 || maxBytes > MAX_BATCH_BYTES) throw new Error('Invalid batch limits.');
  const batches: GeoFeature[][] = [];
  let batch: GeoFeature[] = [], size = 2;
  const ids = new Set<string>();
  for (const feature of features) {
    validateFeature(feature);
    if (ids.has(String(feature.id))) throw new Error('Duplicate feature ID.');
    ids.add(String(feature.id));
    const bytes = Buffer.byteLength(JSON.stringify(feature));
    if (bytes + 2 > MAX_BATCH_BYTES) throw new Error('Feature exceeds staging size limit.');
    if (batch.length && (size + bytes + 1 > maxBytes || batch.length >= maxRows)) { batches.push(batch); batch = []; size = 2; }
    // A polygon over the target size is a singleton, still bounded by the hard cap.
    size += bytes + (batch.length ? 1 : 0); batch.push(feature);
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export function sourceVersion(features: GeoFeature[]): string {
  return createHash('sha256').update(JSON.stringify(features)).digest('hex').slice(0, 16);
}

export function createGeoPublisher(options: { url: string; secretKey: string; fetch?: typeof fetch }) {
  const base = supabaseBaseUrl(options.url);
  if (!/^sb_secret_[A-Za-z0-9_-]+$/.test(options.secretKey)) throw new Error('A server-only sb_secret_ key is required for publishing.');
  const fetcher = options.fetch ?? fetch;
  const headers = { apikey: options.secretKey, 'Content-Type': 'application/json' };
  async function rpc(name: string, body: unknown) {
    return readBoundedJson(await fetcher(`${base}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(60_000) }));
  }
  async function stage(batchId: string, features: GeoFeature[]) {
    for (const batch of featureBatches(features)) await rpc('stage_geo_import', { p_batch: batchId, p_features: batch });
  }
  return {
    async boundaries(collection: { features: GeoFeature[] }, manifest: Record<string, unknown>) {
      featureBatches(collection.features); // Validate the whole release before any staging writes.
      if (typeof manifest.boundary_version !== 'string' || !/^coh-sn-boundaries-[a-f0-9]{16}$/.test(manifest.boundary_version) ||
          collection.features.length !== 88 || collection.features.some(f =>
            typeof f.id !== 'number' || f.id < 1 || f.id > 88 || f.properties.neighborhood_id !== f.id ||
            !['Polygon', 'MultiPolygon'].includes(String((f.geometry as Record<string, unknown>).type)) ||
            f.properties.boundary_version !== manifest.boundary_version)) throw new Error('Incomplete/mixed boundary release.');
      const batchId = `boundary:${sourceVersion(collection.features)}`;
      await stage(batchId, collection.features);
      return rpc('publish_neighborhood_boundaries', { p_batch: batchId, p_manifest: manifest });
    },
    async amenities(snapshot: { sources: SourceManifest[]; features: GeoFeature[] }) {
      featureBatches(snapshot.features);
      if (!Array.isArray(snapshot.sources) || snapshot.sources.length < 1 || snapshot.sources.length > 20 ||
          snapshot.sources.some(source => !source || typeof source.source_id !== 'string' || !/^[a-z][a-z0-9_]{0,79}$/.test(source.source_id) || !Number.isInteger(source.source_count) || source.source_count < 1 || source.source_count > 5000) ||
          new Set(snapshot.sources.map(source => source.source_id)).size !== snapshot.sources.length ||
          snapshot.features.some(feature => !snapshot.sources.some(source => source.source_id === feature.properties.source_id)) ||
          snapshot.sources.some(source => snapshot.features.filter(feature => feature.properties.source_id === source.source_id).length !== source.source_count)) throw new Error('Invalid source manifest.');
      const output: unknown[] = [];
      for (const source of snapshot.sources) {
        const features = snapshot.features.filter(f => f.properties.source_id === source.source_id);
        if (!features.length || features.length !== source.source_count || features.length > 5000) throw new Error(`Incomplete source: ${source.source_id}`);
        const version = sourceVersion(features);
        const batchId = `${source.source_id}:${version}`;
        await stage(batchId, features);
        output.push(await rpc('publish_neighborhood_places', { p_batch: batchId, p_source: { ...source, data_version: version } }));
      }
      return output;
    },
  };
}

async function main() {
  if (process.argv.length > 2) throw new Error('Usage: publish-geodata.js');
  const read = async (name: string) => JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), 'utf8'));
  const publisher = createGeoPublisher({ url: process.env.SUPABASE_URL ?? '', secretKey: process.env.SUPABASE_SECRET_KEY ?? '' });
  console.log(JSON.stringify(await publisher.boundaries(await read('super-neighborhood-boundaries.geojson'), await read('super-neighborhood-boundaries.manifest.json'))));
  console.log(JSON.stringify(await publisher.amenities(await read('neighborhood-amenities.json'))));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'Geodata publish failed.'); process.exitCode = 1; });
}
