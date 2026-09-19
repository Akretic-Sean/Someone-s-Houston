import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCurrentFeeds, getFreshFeed } from '../dist/current-feeds.js';

const NOW = new Date('2026-09-19T17:30:00Z');
const recent = '2026-09-19T17:20:00Z';
function gauge(overrides = {}) {
  return { type: 'Feature', id: 'provider-row-id', geometry: { type: 'Point', coordinates: [-95.4, 29.7] }, properties: {
    time_series_id: 'series-1', monitoring_location_id: 'USGS-08074810', parameter_code: '00065', time: recent,
    value: '38.61', unit_of_measure: 'ft', approval_status: 'Provisional', qualifier: null, last_modified: recent,
    ...overrides,
  } };
}
function alert(overrides = {}) {
  return { type: 'Feature', id: 'https://api.weather.gov/alerts/example', geometry: null, properties: {
    event: 'Flood Watch', headline: 'Flood Watch for part of the Houston area', severity: 'Severe', certainty: 'Possible',
    urgency: 'Future', areaDesc: 'Harris', sent: recent, effective: recent, onset: recent,
    expires: '2026-09-19T18:00:00Z', ends: null, geocode: { UGC: ['TXC201'] }, status: 'Actual', messageType: 'Alert',
    unnecessary_field: 'do not store', ...overrides,
  } };
}
function fetcher({ nws = { type: 'FeatureCollection', updated: recent, features: [] }, usgs = { type: 'FeatureCollection', features: [gauge()] } } = {}) {
  return async (url, options) => {
    assert.match(options.headers['User-Agent'], /github\.com\/Akretic-Sean\/Someone-s-Houston/);
    assert.ok(options.signal instanceof AbortSignal);
    const provider = String(url).includes('api.weather.gov') ? nws : usgs;
    if (provider instanceof Response) return provider;
    if (provider instanceof Error) throw provider;
    if (String(url).includes('api.waterdata.usgs.gov')) {
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get('limit'), '500');
      assert.equal(parsed.searchParams.get('datetime'), '2026-09-19T11:30:00.000Z/..');
    }
    return new Response(JSON.stringify(provider), { headers: { 'content-type': 'application/geo+json' } });
  };
}
test('fresh no-alerts is a valid empty snapshot and observations retain source time/status', async () => {
  const result = await fetchCurrentFeeds({ now: NOW, fetch: fetcher() });
  assert.deepEqual(result.errors, []);
  const [alerts, gauges] = result.feeds;
  assert.equal(alerts.record_count, 0);
  assert.equal(alerts.source_published_at, new Date(recent).toISOString());
  assert.equal(alerts.valid_until, '2026-09-19T17:50:00.000Z');
  assert.equal(gauges.payload.features[0].id, 'series-1');
  assert.equal(gauges.payload.features[0].properties.value, 38.61);
  assert.equal(gauges.payload.features[0].properties.approval_status, 'Provisional');
  assert.equal(gauges.payload.features[0].properties.valid_until, '2026-09-19T23:20:00.000Z');
  assert.equal(gauges.payload.features[0].properties.observed_at, '2026-09-19T17:20:00.000Z');
});
test('stale empty NWS response fails independently instead of overwriting the last good snapshot', async () => {
  const result = await fetchCurrentFeeds({ now: NOW, fetch: fetcher({ nws: {
    type: 'FeatureCollection', updated: '2026-05-28T12:00:00Z', features: [],
  } }) });
  assert.deepEqual(result.feeds.map(f => f.source_id), ['usgs_gauges']);
  assert.equal(result.errors[0].source_id, 'nws_alerts');
  assert.match(result.errors[0].error, /Stale/);
});
test('expired and test alerts are excluded and only selected fields are persisted', async () => {
  const result = await fetchCurrentFeeds({ now: NOW, fetch: fetcher({ nws: {
    type: 'FeatureCollection', updated: recent, features: [alert(), alert({ status: 'Test' }), alert({ expires: recent })],
  } }) });
  const nws = result.feeds.find(f => f.source_id === 'nws_alerts');
  assert.equal(nws.record_count, 1);
  assert.equal(nws.payload.features[0].geometry, null);
  assert.equal(nws.payload.features[0].properties.unnecessary_field, undefined);
  assert.match(nws.note, /2 expired/);
});
test('stale, missing and invalid gauge values are excluded; latest duplicate wins', async () => {
  const result = await fetchCurrentFeeds({ now: NOW, fetch: fetcher({ usgs: {
    type: 'FeatureCollection', features: [gauge({ time: '2026-09-19T17:00:00Z' }), gauge({ value: '39.1' }),
      gauge({ time: '2026-09-18T12:00:00Z' }), gauge({ value: null }), gauge({ value: 'not measured' })],
  } }) });
  const usgs = result.feeds.find(f => f.source_id === 'usgs_gauges');
  assert.equal(usgs.record_count, 1);
  assert.equal(usgs.payload.features[0].properties.value, 39.1);
  assert.match(usgs.note, /3 stale or unavailable/);
});
test('pagination, empty gauges, wrong units and out-of-scope geometry cannot publish', async () => {
  const outOfBounds = gauge(); outOfBounds.geometry.coordinates = [-74, 40];
  for (const usgs of [
    { type: 'FeatureCollection', features: [gauge()], links: [{ rel: 'next', href: 'https://example.com/page2' }] },
    { type: 'FeatureCollection', features: [] },
    { type: 'FeatureCollection', features: [gauge({ unit_of_measure: 'm' })] },
    { type: 'FeatureCollection', features: [outOfBounds] },
  ]) {
    const result = await fetchCurrentFeeds({ now: NOW, fetch: fetcher({ usgs }) });
    assert.deepEqual(result.feeds.map(f => f.source_id), ['nws_alerts']);
    assert.equal(result.errors[0].source_id, 'usgs_gauges');
  }
});
test('source HTTP errors, non-JSON responses and oversized responses remain failures', async () => {
  for (const nws of [
    new Response('unavailable', { status: 503 }),
    new Response('<html>down</html>', { headers: { 'content-type': 'text/html' } }),
    new Response('x'.repeat(2_000_001), { headers: { 'content-type': 'application/json' } }),
  ]) {
    const result = await fetchCurrentFeeds({ now: NOW, fetch: fetcher({ nws }) });
    assert.equal(result.errors[0].source_id, 'nws_alerts');
    assert.deepEqual(result.feeds.map(f => f.source_id), ['usgs_gauges']);
  }
});
test('malformed dates, coordinates and excess rows are rejected', async () => {
  const invalid = gauge(); invalid.geometry.coordinates[0] = 'not longitude';
  for (const usgs of [
    { type: 'FeatureCollection', features: [gauge({ time: '2026-09-20T17:20:00Z' })] },
    { type: 'FeatureCollection', features: [gauge({ time: 'not a date' })] },
    { type: 'FeatureCollection', features: [invalid] },
    { type: 'FeatureCollection', features: Array.from({ length: 501 }, () => gauge()) },
  ]) {
    const result = await fetchCurrentFeeds({ now: NOW, fetch: fetcher({ usgs }) });
    assert.equal(result.errors[0].source_id, 'usgs_gauges');
  }
});
test('reads expire feeds and individual records without changing the stored snapshot', async () => {
  const result = await fetchCurrentFeeds({ now: NOW, fetch: fetcher({ nws: {
    type: 'FeatureCollection', updated: recent, features: [alert({ expires: '2026-09-19T17:35:00Z' })],
  }, usgs: { type: 'FeatureCollection', features: [gauge({ time: '2026-09-19T11:35:00Z' })] } }) });
  const nws = result.feeds.find(f => f.source_id === 'nws_alerts');
  const usgs = result.feeds.find(f => f.source_id === 'usgs_gauges');
  assert.equal(getFreshFeed(nws, new Date('2026-09-19T17:40:00Z')).record_count, 0);
  assert.equal(nws.record_count, 1);
  assert.equal(getFreshFeed(usgs, new Date('2026-09-19T17:40:00Z')), null);
  assert.equal(getFreshFeed(nws, new Date('2026-09-19T18:00:00Z')), null);
  assert.equal(getFreshFeed(nws, new Date('2026-09-19T17:55:00Z')), null); // provider update itself is too old
});
