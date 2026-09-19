import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { createNeighborhoodClient, readBoundedJson } from '../dist/neighborhoods.js';
import { createContextClient } from '../dist/context.js';
import { createEvidenceClient } from '../dist/evidence.js';
import { CATEGORY_IDS, DEFAULT_WEIGHTS, scoreNeighborhoods } from '../../shared/scoring.mjs';

const PROJECT_URL = 'https://hknzivrgihnqzvsafkkr.supabase.co';
const frontend = new URL('../../frontend/report-web/', import.meta.url);

export function connectionConfig(values, source) {
  const url = values.VITE_SUPABASE_URL;
  const publishableKey = values.VITE_SUPABASE_PUBLISHABLE_KEY;
  // Pin this check to the intended project; never send credentials to a typo URL.
  if (url?.replace(/\/$/, '') !== PROJECT_URL) throw new Error('Set VITE_SUPABASE_URL to the project URL in docs/frontend-backend-handoff.md.');
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey ?? '')) {
    throw new Error('Set VITE_SUPABASE_PUBLISHABLE_KEY to a modern publishable key in the ignored frontend env file. Secret keys and placeholders are rejected.');
  }
  return { url: PROJECT_URL, publishableKey, source };
}

export async function loadConnectionConfig({ envFile, env = process.env, read = readFile, mode = 'development' } = {}) {
  if (!/^[a-zA-Z0-9_-]+$/.test(mode)) throw new Error('Invalid Vite mode.');
  if (envFile) {
    const values = parseEnv(await read(resolve(envFile), 'utf8'));
    // Explicit backend-only check; never silently substitute it for frontend config.
    return connectionConfig({
      VITE_SUPABASE_URL: values.VITE_SUPABASE_URL ?? values.SUPABASE_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: values.VITE_SUPABASE_PUBLISHABLE_KEY ?? values.SUPABASE_PUBLISHABLE_KEY,
    }, 'explicit env file (does not verify deployed/frontend configuration)');
  }
  let values = {};
  for (const name of ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`]) {
    try { values = { ...values, ...parseEnv(await read(new URL(name, frontend), 'utf8')) }; }
    catch (error) { if (error?.code !== 'ENOENT') throw new Error('Unable to read frontend env configuration.'); }
  }
  for (const key of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY']) if (env[key] !== undefined) values[key] = env[key];
  // Use literal values in env files. Vite variable expansion is intentionally not simulated.
  return connectionConfig(values, `frontend ${mode} env files / process variables`);
}

export async function checkConnection(config, fetcher = fetch) {
  const origin = 'http://localhost:5173';
  const browserFetch = async (input, init = {}) => {
    const headers = new Headers(init.headers); headers.set('Origin', origin);
    const response = await fetcher(input, { ...init, headers });
    assert.ok(['*', origin].includes(response.headers.get('access-control-allow-origin')), 'Data response does not allow the browser origin.');
    return response;
  };
  const options = { url: config.url, publishableKey: config.publishableKey, fetch: browserFetch };
  const preflight = await fetcher(`${config.url}/rest/v1/rpc/get_neighborhood_scoring_data`, {
    method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'apikey,content-type' },
    signal: AbortSignal.timeout(15_000), redirect: 'error',
  });
  assert.ok(preflight.ok, 'Browser preflight failed.');
  assert.ok(['*', origin].includes(preflight.headers.get('access-control-allow-origin')), 'Browser origin is not allowed.');
  const methods = preflight.headers.get('access-control-allow-methods')?.toUpperCase() ?? '';
  assert.ok(methods === '*' || ['GET', 'POST'].every(wanted => methods.split(',').some(method => method.trim() === wanted)), 'Browser read methods are not allowed.');
  const allowed = preflight.headers.get('access-control-allow-headers')?.toLowerCase() ?? '';
  assert.ok(allowed === '*' || (allowed.includes('apikey') && allowed.includes('content-type')), 'Browser request headers are not allowed.');
  const profilesClient = createNeighborhoodClient(options), context = createContextClient(options), evidence = createEvidenceClient(options);
  const mapRequest = async () => readBoundedJson(await browserFetch(`${config.url}/rest/v1/rpc/get_neighborhood_map`, {
    method: 'POST', headers: { apikey: config.publishableKey, 'Content-Type': 'application/json', Origin: origin }, body: '{}',
    signal: AbortSignal.timeout(15_000), redirect: 'error',
  }), 1_000_000);
  const scoringRequest = async () => readBoundedJson(await browserFetch(`${config.url}/rest/v1/rpc/get_neighborhood_scoring_data`, {
    method: 'POST', headers: { apikey: config.publishableKey, 'Content-Type': 'application/json' }, body: '{}',
    signal: AbortSignal.timeout(15_000), redirect: 'error',
  }), 250_000);
  const [profiles, map, facilities, current, midtown, hiddenValley, floodGap, scoring] = await Promise.all([
    profilesClient.list(), mapRequest(), context.getAmenities({ neighborhood_id: 62, limit: 3 }),
    context.getCurrentConditions({ neighborhood_id: 62, limit: 2 }), evidence.getEvidence({ neighborhood_id: 62 }),
    evidence.getEvidence({ neighborhood_id: 7 }), evidence.getEvidence({ neighborhood_id: 17 }), scoringRequest(),
  ]);
  assert.equal(profiles.length, 88);
  assert.equal(map.type, 'FeatureCollection'); assert.equal(map.features.length, 88);
  assert.equal(new Set(map.features.map(f => f.properties.neighborhood_id)).size, 88);
  assert.ok(map.features.every(f => profiles.some(p => p.neighborhood_id === f.properties.neighborhood_id)));
  const categories = midtown.neighborhoods[0].categories;
  assert.equal(categories.afford.facts?.median_gross_rent_monthly_usd, 1811, 'Midtown evidence is unavailable or changed; inspect source/version.');
  assert.equal(hiddenValley.neighborhoods[0].categories.afford.facts?.median_gross_rent_monthly_usd, null);
  assert.equal(floodGap.neighborhoods[0].categories.flood.facts?.sfha_area_pct, null);
  assert.equal(midtown.safety.tier, null);
  assert.ok(Object.values(categories).every(c => c.score === null));
  assert.ok(categories.commute.facts.destinations.every(d => d.drive_time_minutes === null));
  const preferences = { weights: { ...DEFAULT_WEIGHTS }, tenure: 'rent', mode: 'offer', office: 'ion', airport: 'nearest' };
  const rent = scoreNeighborhoods(scoring, preferences);
  const buy = scoreNeighborhoods(scoring, { ...preferences, tenure: 'buy' });
  const remote = scoreNeighborhoods(scoring, { ...preferences, mode: 'remote' });
  assert.equal(rent.ranked.length, 82, 'Rent comparison coverage changed; inspect missing inputs.');
  assert.equal(buy.ranked.length, 83, 'Buy comparison coverage changed; inspect missing inputs.');
  assert.equal(remote.effectiveWeights.commute, 0);
  assert.deepEqual(rent.unranked.map(row => row.neighborhoodId), [7, 17, 25, 41, 43, 80]);
  const only = id => Object.fromEntries(CATEGORY_IDS.map(key => [key, key === id ? 10 : 0]));
  const officeRanks = ['ion', 'nasa'].map(office => scoreNeighborhoods(scoring, { ...preferences, office, weights: only('commute') }));
  assert.notEqual(officeRanks[0].ranked[0].neighborhoodId, officeRanks[1].ranked[0].neighborhoodId, 'Office selection did not change the live commute-only winner.');
  assert.ok(rent.ranked.every(row => Number.isFinite(row.totalScore) && row.totalScore >= 0 && row.totalScore <= 100));
  assert.throws(() => scoreNeighborhoods(scoring, { ...preferences, weights: Object.fromEntries(CATEGORY_IDS.map(id => [id, 0])) }));
  const names = ['profiles', 'map', 'facilities', 'current context', 'eight-category evidence', 'compact scoring inputs'];
  return {
    status: 'passed', configuration_source: config.source, endpoints: names,
    neighborhoods: 88, joined_map_features: 88, evidence_categories: Object.keys(categories),
    current_feed_statuses: current.feeds.map(f => ({ source_id: f.source_id, availability: f.availability })),
    facility_status: facilities.availability, browser_preflight: 'passed',
    scoring: { model_version: rent.modelVersion, bytes: Buffer.byteLength(JSON.stringify(scoring)), rent_ranked: rent.ranked.length, buy_ranked: buy.ranked.length,
      default_top_three: rent.ranked.slice(0, 3).map(row => ({ id: row.neighborhoodId, name: row.name, score: Number(row.totalScore.toFixed(1)) })),
      office_change: officeRanks.map(result => result.ranked[0].name), remote_commute_weight: remote.effectiveWeights.commute },
    unknown_values: 'Missing rent, withheld flood exposure, route minutes and safety tier preserved. Scores derive from the documented provisional model.',
    scope: 'API/configuration check only; still verify UI rendering, build-time deployment variables and browser network behavior.',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    let envFile, mode = 'development';
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--env-file' && args[i + 1]) envFile = args[++i];
      else if (args[i] === '--mode' && args[i + 1]) mode = args[++i];
      else throw new Error('Usage: npm run test:frontend -- [--mode production] [--env-file path]');
    }
    console.log(JSON.stringify(await checkConnection(await loadConnectionConfig({ envFile, mode })), null, 2));
  } catch (error) {
    // Error details from URLs/headers/response bodies must not leak a credential.
    console.error('Frontend connection check failed. Check env variable names, project URL/publishable-key configuration, network access and evidence freshness. See docs/frontend-backend-handoff.md.');
    process.exitCode = 1;
  }
}
