import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config';
import { readBoundedJson } from './scoringClient.mjs';

export type NeighborhoodBoundaries = FeatureCollection<Polygon | MultiPolygon, {
  neighborhood_id: number; name: string; boundary_version: string;
}>;

const CACHE_MS = 24 * 60 * 60 * 1000;
let cache: { at: number; data: NeighborhoodBoundaries } | undefined;
let pending: Promise<NeighborhoodBoundaries> | undefined;

function validRing(ring: unknown): boolean {
  if (!Array.isArray(ring) || ring.length < 4) return false;
  return ring.every(point => Array.isArray(point) && point.length >= 2
    && Number.isFinite(point[0]) && point[0] >= -96.5 && point[0] <= -94.5
    && Number.isFinite(point[1]) && point[1] >= 29 && point[1] <= 31)
    && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
}

function validate(input: unknown): NeighborhoodBoundaries {
  const data = input as NeighborhoodBoundaries;
  const ids = new Set<number>();
  const versions = new Set<string>();
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features) || data.features.length !== 88) {
    throw new Error('Incomplete neighborhood boundaries.');
  }
  for (const feature of data.features) {
    const props = feature?.properties;
    const geometry = feature?.geometry;
    if (feature?.type !== 'Feature' || !props || !Number.isInteger(props.neighborhood_id)
      || props.neighborhood_id < 1 || props.neighborhood_id > 88 || typeof props.name !== 'string'
      || typeof props.boundary_version !== 'string' || !props.boundary_version
      || !geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) {
      throw new Error('Invalid neighborhood boundaries.');
    }
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    if (!Array.isArray(polygons) || !polygons.length || !polygons.every(polygon =>
      Array.isArray(polygon) && polygon.length > 0 && polygon.every(validRing))) {
      throw new Error('Invalid neighborhood geometry.');
    }
    ids.add(props.neighborhood_id);
    versions.add(props.boundary_version);
  }
  if (ids.size !== 88 || versions.size !== 1) throw new Error('Mismatched neighborhood boundaries.');
  return data;
}

/** Public, simplified WGS84 boundaries; tiles are fetched separately by the map. */
export function fetchNeighborhoodBoundaries(): Promise<NeighborhoodBoundaries> {
  if (cache && Date.now() - cache.at < CACHE_MS) return Promise.resolve(cache.data);
  if (pending) return pending;
  pending = (async () => {
    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_')) {
      throw new Error('Neighborhood boundaries are not configured.');
    }
    const response = await fetch(new URL('/rest/v1/rpc/get_neighborhood_map', SUPABASE_URL), {
      method: 'POST', headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
      body: '{}', redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('Neighborhood boundaries are temporarily unavailable.');
    const data = validate(await readBoundedJson(response, 5_000_000));
    cache = { data, at: Date.now() };
    return data;
  })().finally(() => { pending = undefined; });
  return pending;
}
