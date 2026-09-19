import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { prepareBoundaries } from '../dist/prepare-boundaries.js';

const reference = JSON.parse(await readFile(new URL('../data/super-neighborhoods.json', import.meta.url), 'utf8'));
const ring = [[-95.5, 29.7], [-95.4, 29.7], [-95.4, 29.8], [-95.5, 29.7]];
const source = () => ({
  type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'EPSG:4326' } },
  features: reference.map(row => ({ type: 'Feature', properties: { POLYID: row.neighborhood_id, SNBNAME: row.name }, geometry: { type: 'Polygon', coordinates: [structuredClone(ring)] } })),
});

test('boundary IDs join profiles and version is stable across feature order and ring direction', () => {
  const input = source();
  const a = prepareBoundaries(input, reference);
  input.features.reverse();
  for (const feature of input.features) feature.geometry.coordinates[0].reverse();
  const b = prepareBoundaries(input, reference);
  assert.deepEqual(a, b);
  assert.deepEqual(a.collection.features.map(f => f.id), Array.from({ length: 88 }, (_, i) => i + 1));
  assert.equal(a.collection.features[61].properties.name, 'MIDTOWN');
});

test('rejects incomplete/duplicate IDs, renamed neighborhoods and incorrect coordinate systems', () => {
  for (const mutate of [
    input => { input.exceededTransferLimit = true; },
    input => { input.features.pop(); },
    input => { input.features[1] = structuredClone(input.features[0]); },
    input => { input.features[0].properties.SNBNAME = 'Wrong'; },
    input => { input.crs.properties.name = 'EPSG:2278'; },
  ]) {
    const input = source(); mutate(input);
    assert.throws(() => prepareBoundaries(input, reference));
  }
});

test('rejects swapped, unclosed and degenerate coordinates instead of silently repairing geography', () => {
  for (const invalidRing of [
    ring.map(([lon, lat]) => [lat, lon]),
    [...ring.slice(0, 3), [-95.51, 29.7]],
    [[-95.5, 29.7], [-95.4, 29.7], [-95.3, 29.7], [-95.5, 29.7]],
  ]) {
    const input = source(); input.features[0].geometry.coordinates = [invalidRing];
    assert.throws(() => prepareBoundaries(input, reference));
  }
});

test('stored snapshot hash, counts and geometry match its manifest and all current profiles', async () => {
  const content = await readFile(new URL('../data/super-neighborhood-boundaries.geojson', import.meta.url), 'utf8');
  const manifest = JSON.parse(await readFile(new URL('../data/super-neighborhood-boundaries.manifest.json', import.meta.url), 'utf8'));
  const collection = JSON.parse(content);
  assert.equal(createHash('sha256').update(content).digest('hex'), manifest.sha256);
  assert.equal(Buffer.byteLength(content), manifest.json_bytes);
  const arcgis = { type: 'FeatureCollection', features: collection.features.map(f => ({ ...f, properties: { POLYID: f.id, SNBNAME: f.properties.name } })) };
  const prepared = prepareBoundaries(arcgis, reference);
  assert.deepEqual(collection, prepared.collection);
  assert.equal(manifest.feature_count, 88);
  assert.equal(manifest.position_count, prepared.positionCount);
  assert.equal(manifest.boundary_version, prepared.boundaryVersion);
  assert.equal(manifest.source_boundary_effective_date, null);
});
