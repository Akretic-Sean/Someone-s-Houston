import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, MARKER, referenceProblems, supplementProblems, checkHealth, syncIssue } from '../tools/monitor-data.mjs';

const NOW = Date.parse('2026-09-19T18:00:00Z');
const iso = offset => new Date(NOW + offset).toISOString();
function references() {
  const profiles = Array.from({ length: 88 }, (_, i) => ({ neighborhood_id: i + 1, data_version: 'profile-v1' }));
  return {
    profiles, boundaries: profiles.map(p => ({ neighborhood_id: p.neighborhood_id, boundary_version: 'boundary-v1' })),
    supplementSources: ['metro_gtfs','hpd_crime_2024'].map(source_id=>({source_id,source_checked_at:iso(-1000),refresh_due_at:iso(30*86400000),boundary_version:'boundary-v1'})),
    supplementRows: ['metro_gtfs','hpd_crime_2024'].flatMap(source_id=>profiles.map(p=>({source_id,neighborhood_id:p.neighborhood_id}))),
    sources: Array.from({ length: 8 }, (_, i) => ({ source_id: `source_${i}`, data_version: 'source-v1', boundary_version: 'boundary-v1' })),
    evidence: profiles.flatMap(p => CATEGORIES.map(category_id => ({ neighborhood_id: p.neighborhood_id, category_id,
      prepared_at: iso(-1000), refresh_due_at: iso(90 * 86400000), boundary_version: 'boundary-v1',
      dependencies: [{ kind: 'profile', version: p.data_version }, { kind: 'places', source_id: 'source_0', version: 'source-v1' }],
    }))),
  };
}
function current() {
  return { checked_at: iso(0), neighborhood_id: null, feeds: ['nws_alerts', 'usgs_gauges'].map(source_id => {
    const features = source_id === 'nws_alerts' ? [] : [{ type: 'Feature', id: 'gauge-1', geometry: { type: 'Point', coordinates: [-95.4, 29.7] }, properties: {
      monitoring_location_id: 'USGS-08074810', time_series_id: 'gauge-1', parameter_code: '00065', time: iso(-60000), observed_at: iso(-60000),
      valid_until: iso(21_540_000), value: 39, unit_of_measure: 'ft', approval_status: 'Provisional', qualifier: null,
      source_url: 'https://waterdata.usgs.gov/monitoring-location/USGS-08074810/',
    } }];
    return { source_id, source_url: 'https://example.gov/', source_checked_at: iso(-60000), source_published_at: iso(-60000),
      valid_until: iso(1_740_000), availability: 'current', record_count: features.length,
      payload: { type: 'FeatureCollection', features }, attribution: 'Official source', note: 'Test' };
  }) };
}
function api(snapshot = references(), live = current()) {
  return async (url, init) => {
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
    const table = new URL(url).pathname.split('/').at(-1);
    return Response.json(({ neighborhood_category_evidence: snapshot.evidence, neighborhood_profiles: snapshot.profiles,
      neighborhood_boundaries: snapshot.boundaries, neighborhood_sources: snapshot.sources, get_current_context: live,
      neighborhood_supplement_sources:snapshot.supplementSources,neighborhood_supplements:snapshot.supplementRows })[table]);
  };
}
const options = { url: 'https://test.supabase.co', publishableKey: 'sb_publishable_test', now: NOW };

test('optional context monitoring catches short transit expiry, lost rows and boundary drift',()=>{
  const snapshot=references();
  const input={sources:snapshot.supplementSources,rows:snapshot.supplementRows,boundaries:snapshot.boundaries};
  assert.deepEqual(supplementProblems(input,NOW),[]);
  input.sources[0].refresh_due_at=iso(86400000);
  assert.equal(supplementProblems(input,NOW)[0].severity,'warning');
  input.sources[0].boundary_version='obsolete';
  assert.equal(supplementProblems(input,NOW)[0].severity,'critical');
  input.rows.pop();assert.throws(()=>supplementProblems(input,NOW));
});

test('monitor accepts fresh zero NWS alerts and validates both live and reference layers', async () => {
  assert.deepEqual(await checkHealth({ ...options, fetch: api() }), []);
  const live = current(); live.feeds[1].payload.features = []; live.feeds[1].record_count = 0;
  assert.equal((await checkHealth({ ...options, fetch: api(references(), live) }))[0].code, 'live:usgs_gauges');
  live.feeds[0].source_checked_at = iso(-1_800_001);
  assert.equal((await checkHealth({ ...options, fetch: api(references(), live) })).length, 2);
});

test('reference warning begins at 14 days; expired evidence and version drift are critical', () => {
  const snapshot = references();
  snapshot.evidence[0].refresh_due_at = iso(14 * 86400000);
  assert.equal(referenceProblems(snapshot, NOW)[0].severity, 'warning');
  snapshot.evidence[0].refresh_due_at = iso(0);
  assert.equal(referenceProblems(snapshot, NOW)[0].severity, 'critical');
  snapshot.profiles[0].data_version = 'changed';
  assert.equal(referenceProblems(snapshot, NOW).filter(p => p.code.endsWith(':dependency')).length, 8);
  snapshot.sources[0].boundary_version = 'changed';
  assert.ok(referenceProblems(snapshot, NOW).some(p => p.code === 'facilities:boundary'));
});

test('missing, duplicate, malformed or inconsistent evidence never passes health checks', async () => {
  for (const mutate of [s => s.evidence.pop(), s => s.evidence[1] = s.evidence[0],
    s => s.evidence[0].refresh_due_at = 'bad-date', s => s.evidence[0].prepared_at = iso(600000),
    s => s.boundaries[0].boundary_version = 'mixed', s => s.evidence[0].dependencies = [{ kind: 'unknown' }]]) {
    const snapshot = references(); mutate(snapshot);
    assert.throws(() => referenceProblems(snapshot, NOW));
    assert.ok((await checkHealth({ ...options, fetch: api(snapshot) })).some(p => p.code === 'reference:probe'));
  }
});

test('HTTP failure and malformed live data report sanitized errors without hiding reference expiry', async () => {
  const snapshot = references(); snapshot.evidence[0].refresh_due_at = iso(0);
  const problems = await checkHealth({ ...options, fetch: api(snapshot, {}) });
  assert.equal(problems.length, 2);
  const failed = await checkHealth({ ...options, fetch: async () => new Response('secret-provider-error', { status: 503 }) });
  assert.equal(failed.length, 3);
  assert.ok(!JSON.stringify(failed).includes('secret-provider-error'));
});

test('GitHub alert creates once, remains quiet, updates, closes on recovery and reopens the same issue', async () => {
  const issues = []; const writes = [];
  const fetch = async (url, init) => {
    if (init.method === 'GET') return Response.json(issues);
    const body = JSON.parse(init.body); writes.push(body);
    if (init.method === 'POST') issues.push({ number: 1, state: 'open', user: { login: 'github-actions[bot]' }, ...body });
    else Object.assign(issues[0], body);
    return Response.json(issues[0]);
  };
  const options = { repository: 'Akretic-Sean/Someone-s-Houston', token: 'test', fetch };
  const problems = [{ code: 'live:nws_alerts', severity: 'critical', message: 'NWS is stale.' }];
  assert.equal(await syncIssue({ ...options, problems: [] }), 'healthy');
  assert.equal(await syncIssue({ ...options, problems }), 'created');
  assert.deepEqual(writes[0].assignees, ['Akretic-Sean']);
  assert.equal(await syncIssue({ ...options, problems }), 'unchanged');
  assert.equal(writes.length, 1);
  assert.equal(await syncIssue({ ...options, problems: [] }), 'closed');
  assert.equal(await syncIssue({ ...options, problems: [] }), 'unchanged');
  assert.equal(await syncIssue({ ...options, problems }), 'updated');
  assert.equal(issues.length, 1); assert.equal(issues[0].state, 'open');
});

test('alert ignores user-authored lookalike issues and fails visibly if GitHub rejects writes', async () => {
  const problems = [{ code: 'live:probe', severity: 'critical', message: 'Probe failed.' }];
  let method;
  await assert.rejects(syncIssue({ repository: 'owner/repo', token: 'test', problems, fetch: async (url, init) => {
    if (init.method === 'GET') return Response.json([{ number: 3, user: { login: 'stranger' }, body: MARKER }]);
    method = init.method; return new Response('Forbidden', { status: 403 });
  } }));
  assert.equal(method, 'POST');
});
