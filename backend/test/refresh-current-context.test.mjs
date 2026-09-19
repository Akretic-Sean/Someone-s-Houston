import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshHandler } from '../dist/refresh-current-context.js';

const NOW = new Date('2026-09-19T18:00:00Z');
const token = '4c'.repeat(32);
const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), n => n.toString(16).padStart(2, '0')).join('');
const secret = 'sb_secret_test_only_server_key';
const jwt = [Buffer.from('{"alg":"HS256"}').toString('base64url'), Buffer.from('{"role":"service_role"}').toString('base64url'), 'fake-signature'].join('.');
const base = { tokenSha256: digest, supabaseUrl: 'https://test.supabase.co', serviceRoleKey: secret, now: () => NOW };
const request = (value = token, method = 'POST', body) => new Request('https://example.test/refresh', {
  method, headers: value === null ? {} : { 'x-refresh-token': value }, ...(body ? { body } : {}),
});
function providers({ failNws = false, failUsgs = false, failWrite, throwWrite = false } = {}) {
  const writes = [], requests = [];
  const fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes('/rest/v1/')) {
      const row = JSON.parse(options.body); writes.push(row);
      if (throwWrite) throw new Error(`internal error exposing ${secret} ${token}`);
      if (row.source_id === failWrite) return new Response(`server debug ${secret}`, { status: 503 });
      return new Response(null, { status: 201 });
    }
    if (String(url).includes('api.weather.gov')) {
      if (failNws) throw new Error(`untrusted provider error ${secret} ${token}`);
      return Response.json({ type: 'FeatureCollection', updated: '2026-09-19T17:58:00Z', features: [] });
    }
    if (failUsgs) return new Response('bad gateway', { status: 502 });
    return Response.json({ type: 'FeatureCollection', features: [{
      type: 'Feature', id: 'provider-row', geometry: { type: 'Point', coordinates: [-95.4, 29.7] }, properties: {
        time_series_id: 'series1', monitoring_location_id: 'USGS-08074810', parameter_code: '00065',
        time: '2026-09-19T17:30:00Z', value: '39', unit_of_measure: 'ft', approval_status: 'Provisional',
        qualifier: null, last_modified: '2026-09-19T17:40:00Z',
      },
    }] });
  };
  return { fetch, writes, requests };
}
test('missing, malformed and wrong refresh credentials make no network calls', async () => {
  let calls = 0;
  const handler = createRefreshHandler({ ...base, fetch: async () => { calls++; throw new Error('must not fetch'); } });
  for (const value of [null, '', 'bad-token', '00'.repeat(32), `${token}x`]) {
    const response = await handler(request(value));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Unauthorized.' });
  }
  assert.equal(calls, 0);
});
test('only POST is accepted and the valid credential uses a real SHA-256 handshake', async () => {
  const mock = providers();
  const handler = createRefreshHandler({ ...base, fetch: mock.fetch });
  const rejected = await handler(request(token, 'GET'));
  assert.equal(rejected.status, 405);
  assert.equal(rejected.headers.get('allow'), 'POST');
  assert.equal(mock.requests.length, 0);
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ok');
  assert.equal(mock.writes.length, 2);
});
test('modern keys stay in apikey; legacy service-role JWT also gets Authorization', async () => {
  for (const key of [secret, jwt]) {
    const mock = providers();
    const handler = createRefreshHandler({ ...base, serviceRoleKey: key, fetch: mock.fetch });
    await handler(request());
    for (const call of mock.requests.filter(c => c.url.includes('/rest/v1/'))) {
      assert.equal(call.url, 'https://test.supabase.co/rest/v1/live_context?on_conflict=source_id');
      assert.equal(call.options.headers.apikey, key);
      assert.equal(call.options.headers.Authorization, key === jwt ? `Bearer ${jwt}` : undefined);
      assert.equal(call.options.headers.Prefer, 'resolution=merge-duplicates,return=minimal');
      assert.equal(call.options.redirect, 'error');
      assert.ok(call.options.signal instanceof AbortSignal);
    }
    for (const call of mock.requests.filter(c => !c.url.includes('/rest/v1/'))) {
      assert.equal(call.options.headers.apikey, undefined);
      assert.equal(call.options.headers.Authorization, undefined);
    }
  }
});
test('partial provider failure preserves the failed source and reports partial success', async () => {
  const mock = providers({ failNws: true });
  const response = await createRefreshHandler({ ...base, fetch: mock.fetch })(request());
  assert.equal(response.status, 207);
  const text = await response.text();
  assert.ok(!text.includes(secret) && !text.includes(token));
  const result = JSON.parse(text);
  assert.equal(result.status, 'partial');
  assert.deepEqual(mock.writes.map(row => row.source_id), ['usgs_gauges']);
  assert.equal(result.errors[0].source_id, 'nws_alerts');
  assert.equal(result.errors[0].stage, 'fetch');
});
test('all provider failures cause HTTP502 and no database writes', async () => {
  const mock = providers({ failNws: true, failUsgs: true });
  const response = await createRefreshHandler({ ...base, fetch: mock.fetch })(request());
  assert.equal(response.status, 502);
  const result = await response.json();
  assert.equal(result.status, 'error');
  assert.deepEqual(result.updated, []);
  assert.equal(result.errors.length, 2);
  assert.equal(mock.writes.length, 0);
});
test('write failures do not erase other successes or expose database responses', async () => {
  const mock = providers({ failWrite: 'nws_alerts' });
  const response = await createRefreshHandler({ ...base, fetch: mock.fetch })(request());
  assert.equal(response.status, 207);
  const text = await response.text();
  assert.ok(!text.includes(secret));
  const result = JSON.parse(text);
  assert.deepEqual(result.updated.map(row => row.source_id), ['usgs_gauges']);
  assert.equal(result.errors[0].stage, 'publish');
});
test('uncertain write failures return no arbitrary exception text', async () => {
  const mock = providers({ throwWrite: true });
  const response = await createRefreshHandler({ ...base, fetch: mock.fetch })(request());
  assert.equal(response.status, 502);
  const text = await response.text();
  assert.ok(!text.includes(secret) && !text.includes(token));
  assert.match(text, /could not be confirmed/);
});
test('request body cannot change destinations, database tables or selected public sources', async () => {
  const mock = providers();
  const handler = createRefreshHandler({ ...base, fetch: mock.fetch });
  const response = await handler(request(token, 'POST', JSON.stringify({ source_url: 'http://127.0.0.1/secrets', table: 'users', sql: 'delete from users' })));
  assert.equal(response.status, 200);
  assert.equal(mock.requests.length, 4);
  assert.ok(mock.requests.every(call => !call.url.includes('127.0.0.1')));
  assert.deepEqual(mock.writes.map(row => row.source_id), ['nws_alerts', 'usgs_gauges']);
});
test('invalid server configuration fails before a handler can make requests', () => {
  for (const overrides of [
    { tokenSha256: 'not a hash' }, { serviceRoleKey: 'sb_publishable_not_admin' },
    { serviceRoleKey: [jwt.split('.')[0], Buffer.from('{"role":"anon"}').toString('base64url'), 'signature'].join('.') },
    { supabaseUrl: 'https://user:password@test.supabase.co' }, { supabaseUrl: 'https://test.supabase.co/arbitrary' },
  ]) assert.throws(() => createRefreshHandler({ ...base, ...overrides }));
});
