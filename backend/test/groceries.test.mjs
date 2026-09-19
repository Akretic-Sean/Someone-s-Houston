import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGrocery, fetchGroceries } from '../dist/prepare-groceries.js';

const raw = () => ({ attributes: { ObjectId: 7, Record_ID: 12345, Store_Name: 'Example grocery', Store_Type: 'Supermarket', Store_Street_Address: '123 Main Street', City: 'Houston', State: 'TX', Zip_Code: '77002', Latitude: 29.75, Longitude: -95.36 }, geometry: { x: -95.36, y: 29.75 } });
const names = ['ObjectId','Record_ID','Store_Name','Store_Type','Store_Street_Address','City','State','Zip_Code','Latitude','Longitude'];
const metadata = () => ({ objectIdField: 'ObjectId', geometryType: 'esriGeometryPoint', maxRecordCount: 1000, fields: names.map(name => ({ name, type: name === 'ObjectId' ? 'esriFieldTypeOID' : 'esriFieldTypeString' })), editingInfo: { dataLastEditDate: Date.parse('2026-09-17T12:00:00Z') } });
function mock(options = {}) {
  let metaCalls = 0;
  return async (url, request) => {
    const params = request?.body ? new URLSearchParams(request.body) : new URL(url).searchParams;
    if (!url.includes('/query')) return Response.json({ ...metadata(), ...(options.changed && ++metaCalls > 1 ? { editingInfo: { dataLastEditDate: Date.parse('2026-09-18T12:00:00Z') } } : {}) });
    assert.match(params.get('where'), /Grocery Store/);
    if (params.get('returnCountOnly')) return Response.json({ count: 1 });
    if (params.get('returnIdsOnly')) return Response.json({ objectIdFieldName: 'ObjectId', objectIds: [7] });
    return Response.json({ features: options.incomplete ? [] : [raw()] });
  };
}

test('normalization preserves stable USDA retailer ID and selected public fields only', () => {
  const result = normalizeGrocery(raw());
  assert.equal(result.id, 'usda_snap_grocery:12345');
  assert.equal(result.properties.category, 'grocery_stores');
  assert.deepEqual(result.geometry.coordinates, [-95.36,29.75]);
  assert.equal(result.properties.address, '123 Main Street, Houston, TX 77002');
});
test('rejects convenience stores and contradictory or outside-region coordinates', () => {
  assert.throws(() => normalizeGrocery({ ...raw(), attributes: { ...raw().attributes, Store_Type: 'Convenience Store' } }));
  assert.throws(() => normalizeGrocery({ ...raw(), geometry: { x: -95.37, y: 29.75 } }), /disagree/);
  assert.throws(() => normalizeGrocery({ ...raw(), geometry: { x: 0, y: 0 } }));
});
test('bounded import records source edition separately from checked date and warns about coverage', async () => {
  const result = await fetchGroceries({ fetch: mock(), checkedAt: '2026-09-19T12:00:00Z' });
  assert.equal(result.features.length, 1);
  assert.equal(result.sources[0].source_published_at, '2026-09-17T12:00:00.000Z');
  assert.match(result.sources[0].note, /not a census/);
});
test('rejects incomplete batches, changed inventory and excessive source response bytes', async () => {
  await assert.rejects(fetchGroceries({ fetch: mock({ incomplete: true }), checkedAt: '2026-09-19T12:00:00Z' }), /incomplete/);
  await assert.rejects(fetchGroceries({ fetch: mock({ changed: true }), checkedAt: '2026-09-19T12:00:00Z' }), /changed/);
  await assert.rejects(fetchGroceries({ fetch: mock(), checkedAt: '2026-09-19T12:00:00Z', maxBytes: 20 }), /response limit/);
});
