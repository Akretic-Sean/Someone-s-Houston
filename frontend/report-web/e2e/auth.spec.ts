import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { CATEGORY_IDS, DEFAULT_WEIGHTS, MODEL_VERSION } from '../../../shared/scoring.mjs';

const storageKey = 'sb-hknzivrgihnqzvsafkkr-auth-token';
function session(email = 'recruiter@example.test', expired = false) {
  const user = { id: email, email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  const expires_at = Math.floor(Date.now() / 1000) + (expired ? -3600 : 3600);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return { access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: expires_at, role: 'authenticated' })}.test-signature`,
    refresh_token: 'test-refresh-token', expires_in: 3600, expires_at, token_type: 'bearer', user };
}

function baseScoringFixture() {
  return {
    schema_version: 1, model_version: MODEL_VERSION, evaluated_at: new Date().toISOString(),
    category_definitions: CATEGORY_IDS.map(id => ({ id, label: id, default_weight: DEFAULT_WEIGHTS[id] })),
    neighborhoods: Array.from({ length: 88 }, (_, index) => {
      const id = index + 1;
      const metrics = {
        afford: { rent_usd: 1000 + id, home_value_usd: 400000 - id * 1000 },
        commute: { ion: id * 100, downtown: (89 - id) * 100, energy: id * 200, tmc: id * 300, nasa: id * 400 },
        flood: { sfha_area_pct: id / 2 },
        amen: { libraries: id * 100, museums: id * 200, community_centers: id * 300, multi_service_centers: id * 400 },
        fit: { parks: id * 100, community_centers: id * 200 }, food: { grocery_stores: id * 100 },
        air: { iah: id * 100, hou: (89 - id) * 150 },
        health: { hospitals: id * 100, health_facilities: id * 200, multi_service_centers: id * 300 },
      };
      return { neighborhood_id: id, name: `Neighborhood ${id}`, reference_point: { latitude: 29.75 + index / 1000, longitude: -95.65 + (index % 11) * .045 },
        categories: Object.fromEntries(CATEGORY_IDS.map(category => [category, {
          availability: 'partial', refresh_due_at: new Date(Date.now() + 86400000).toISOString(),
          evidence_version: 'browser-test-v1', metrics: metrics[category],
        }])),
      };
    }),
  };
}

function scoringFixture(expired = false) {
  const base = baseScoringFixture();
  (base.neighborhoods[6].categories.afford.metrics as any).rent_usd = null;
  for (const id of [17, 25, 41, 43, 80]) (base.neighborhoods[id - 1].categories.flood.metrics as any).sfha_area_pct = null;
  const estimates = JSON.parse(readFileSync(new URL('../../../backend/data/neighborhood-gap-inputs.json', import.meta.url), 'utf8')).rows.map((e: any) => ({
    ...e, source_checked_at: new Date(Date.now() - 60000).toISOString(),
    refresh_due_at: new Date(Date.now() + (expired ? -1000 : 3600000)).toISOString(), base_evidence_version: 'browser-test-v1',
  }));
  return { schema_version: 1, policy_version: 'source-bounded-v1', base, estimates };
}

async function mockApi(page: Page, options: { failLogout?: boolean; expiredSession?: boolean; signupStatus?: number; aiStatus?: number; degrade?: boolean; expiredBounds?: boolean } = {}) {
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  if (process.env.LIVE_MAP_TILES !== '1') await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/svg+xml', body: tileFixture }));
  const state = { scoringReads: 0, failLogout: options.failLogout ?? false, signupRequests: [] as Record<string, unknown>[],
    signupStatus: options.signupStatus ?? 201, aiRequests: [] as Record<string, any>[] };
  // Every Supabase request is intercepted: these tests never create users or send mail.
  await page.route('https://hknzivrgihnqzvsafkkr.supabase.co/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/report-flow')) {
      expect(route.request().headers().authorization).toMatch(/^Bearer /);
      const input = route.request().postDataJSON();
      state.aiRequests.push(input);
      if (options.aiStatus) return route.fulfill({ status: options.aiStatus, json: { error: 'usage_limit' } });
      if (input.action === 'extract') {
        const fields = Object.fromEntries(Object.keys(input.input.answers).map(id => [id, {
          value: input.input.answers[id] || (id === 'office' ? 'Midtown' : null), confidence: 'high', evidence: id === 'office' ? 'Midtown' : null,
        }]));
        return route.fulfill({ json: { status: 'generated', data: { fields, unanswered: [] } } });
      }
      return route.fulfill({ json: { payload: scoringFixture(options.expiredBounds), generatedAt: new Date().toISOString(), narrative: {
        status: options.degrade ? 'degraded' : 'generated', text: options.degrade ? null : 'Your selected priorities favor these relative matches.',
        expiresAt: new Date(Date.now() + 3600000).toISOString(), facts: [{ id: 'match_1', label: 'Computed match', value: 'Neighborhood 1', source: 'Verified scoring evidence' }],
      } } });
    }
    if (url.pathname.endsWith('/username-signup')) {
      state.signupRequests.push(route.request().postDataJSON());
      return route.fulfill({ status: state.signupStatus, json: state.signupStatus === 201 ? { created: true } : { error: 'signup_rejected' } });
    }
    if (url.pathname.endsWith('/token')) {
      const input = route.request().postDataJSON();

      if (options.expiredSession || input.password === 'wrongpass') {
        return route.fulfill({ status: 400, json: { code: 'invalid_credentials', msg: 'Invalid login credentials' } });
      }
      return route.fulfill({ json: session(input.email) });
    }
    if (url.pathname.endsWith('/logout')) return state.failLogout
      ? route.fulfill({ status: 500, json: { msg: 'Temporary failure' } })
      : route.fulfill({ status: 204 });
    if (url.pathname.endsWith('/user')) return route.fulfill({ json: session().user });
    if (url.pathname.endsWith('/get_neighborhood_scoring_data_with_estimates')) {
      state.scoringReads++;
      return route.fulfill({ json: scoringFixture(options.expiredBounds) });
    }
    return route.fulfill({ status: 503, json: { message: 'Detailed evidence unavailable in auth fixture' } });
  });
  return state;
}

async function signIn(page: Page, username = 'recruiter') {
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill('Demo-password-123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test('login gates scoring; logout clears generated reports before the next account', async ({ page }) => {
  const state = await mockApi(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Google/ })).toHaveCount(0);
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Email', { exact: true })).toHaveCount(0);
  expect(state.scoringReads).toBe(0);
  await page.getByLabel('Username', { exact: true }).fill('recruiter');
  await page.getByLabel('Password', { exact: true }).fill('wrongpass');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Incorrect username or password');
  expect(state.scoringReads).toBe(0);
  await signIn(page);
  await expect(page.getByText('88 of 88 neighborhoods can be ranked.')).toBeVisible();
  await page.getByRole('button', { name: 'Fully remote', exact: true }).click();
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await page.getByRole('button', { name: 'Generate report', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Top neighborhood matches' })).toBeVisible();
  await expect(page.getByText('Commute is excluded in fully remote mode.', { exact: false })).toBeVisible();
  expect(state.scoringReads).toBe(1);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await signIn(page, 'second');
  await expect(page.getByRole('heading', { name: 'Configure and generate' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Neighborhood report', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Rent', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Office / offer mode', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('stored session restores; failed remote logout still clears this device', async ({ page }) => {
  const state = await mockApi(page, { failLogout: true });
  await page.addInitScript(({ key, value }) => { localStorage.setItem(key, JSON.stringify(value)); }, { key: storageKey, value: session() });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Configure and generate' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Signed out on this device. Could not confirm sign-out on other devices.');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
  state.failLogout = false;
  await signIn(page);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
});

test('unrefreshable stored session returns to login without loading report data', async ({ page }) => {
  const state = await mockApi(page, { expiredSession: true });
  await page.addInitScript(({ key, value }) => { localStorage.setItem(key, JSON.stringify(value)); }, { key: storageKey, value: session('expired@example.test', true) });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  expect(state.scoringReads).toBe(0);
});

test('new users choose username and password and immediately enter the report flow', async ({ page }, testInfo) => {
  const state = await mockApi(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.getByRole('button', { name: 'Create a new account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Create your account', exact: true })).toBeVisible();
  await expect(page.getByText('Choose a new username and password to get started. No email required.')).toBeVisible();
  await page.getByLabel('Username', { exact: true }).fill('New_User');
  await page.getByLabel('Password', { exact: true }).fill('Demo-password-123!');
  await page.screenshot({ path: testInfo.outputPath('create-account.png'), fullPage: true });
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Configure and generate' })).toBeVisible();
  expect(state.signupRequests).toEqual([{ username: 'new_user', password: 'Demo-password-123!' }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('duplicate usernames and signup limits leave visitors signed out', async ({ page }) => {
  const state = await mockApi(page, { signupStatus: 409 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.getByRole('button', { name: 'Create a new account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Create your account', exact: true })).toBeVisible();
  await expect(page.getByText('Choose a new username and password to get started. No email required.')).toBeVisible();
  await page.getByLabel('Username', { exact: true }).fill('new_user');
  await page.getByLabel('Password', { exact: true }).fill('Demo-password-123!');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('That username is taken');
  state.signupStatus = 429;
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Signups are busy');
  expect(state.scoringReads).toBe(0);
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
});

test('notes are reviewed before an authenticated AI report; changing priorities clears the report', async ({ page }, testInfo) => {
  const state = await mockApi(page);
  await page.goto('/'); await signIn(page);
  await page.getByLabel('Relocation notes', { exact: true }).fill('Work in Midtown');
  await page.getByRole('button', { name: 'Extract preferences', exact: true }).click();
  await expect(page.getByLabel('Work location', { exact: true })).toHaveValue('Midtown');
  await page.getByLabel('Work location', { exact: true }).fill('Downtown');
  await page.getByRole('button', { name: 'Generate report', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your report at a glance' })).toBeVisible();
  await expect(page.getByText('Your selected priorities favor these relative matches.')).toBeVisible();
  expect(state.aiRequests.map(request => request.action)).toEqual(['extract', 'generate']);
  expect(state.aiRequests[1].preferences.office).toBe('Downtown');
  expect(state.aiRequests[1].options.office).toBe('ion');
  expect(state.aiRequests[1].scoringPolicy).toBe('source-bounded-v1');
  expect(state.aiRequests[1].facts).toBeUndefined();
  expect(state.aiRequests[0].requestId).not.toBe(state.aiRequests[1].requestId);
  await page.screenshot({ path: testInfo.outputPath('ai-report.png'), fullPage: true });
  await page.getByRole('button', { name: 'Adjust priorities', exact: true }).click();
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Neighborhood report', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('an AI quota failure allows a factual report without another model request', async ({ page }) => {
  const state = await mockApi(page, { aiStatus: 429 });
  await page.goto('/'); await signIn(page);
  await page.getByRole('button', { name: 'Generate report', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('AI usage limit');
  await page.getByRole('button', { name: 'Continue with factual report', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Top neighborhood matches' })).toBeVisible();
  await expect(page.getByText('Showing the factual report without an AI explanation.', { exact: false })).toBeVisible();
  expect(state.aiRequests.length).toBe(1);
});

test('a degraded AI response still renders a real ranked report', async ({ page }) => {
  await mockApi(page, { degrade: true });
  await page.goto('/'); await signIn(page);
  await page.getByRole('button', { name: 'Generate report', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Top neighborhood matches' })).toBeVisible();
  await expect(page.getByText('Showing the factual report without an AI explanation.', { exact: false })).toBeVisible();
});

function boundaryFixture() {
  return { type: 'FeatureCollection', features: scoringFixture().base.neighborhoods.map(row => {
    const { latitude: lat, longitude: lon } = row.reference_point;
    return { type: 'Feature', properties: { neighborhood_id: row.neighborhood_id, name: row.name, boundary_version: 'fixture-v1' },
      geometry: { type: 'Polygon', coordinates: [[[lon - .003, lat - .003], [lon + .003, lat - .003],
        [lon + .003, lat + .003], [lon - .003, lat + .003], [lon - .003, lat - .003]]] } };
  }) };
}

const tileFixture = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#dedede"/><path d="M0 90H256 M100 0V256" stroke="#fff" stroke-width="8"/></svg>';

test('geographic map loads boundaries, keeps markers aligned on zoom, and selects evidence', async ({ page, isMobile }, testInfo) => {
  await mockApi(page);
  let boundaryReads = 0;
  await page.route('**/rest/v1/rpc/get_neighborhood_map', route => {
    boundaryReads++;
    return route.fulfill({ json: boundaryFixture() });
  });
  await page.goto('/');
  await signIn(page);
  await page.getByRole('button', { name: 'Generate report', exact: true }).click();
  const map = page.getByRole('region', { name: 'Houston neighborhood map' });
  await expect(map.locator('.leaflet-tile-loaded').first()).toBeVisible();
  await expect(map.locator('[data-neighborhood-id]')).toHaveCount(88);
  await expect(map.locator('path.leaflet-interactive')).toHaveCount(88);
  await expect(map.getByRole('link', { name: 'OpenStreetMap' })).toBeVisible();
  const firstPick = map.locator('[data-pin]').first();
  const selectedId = await firstPick.getAttribute('data-pin');
  if (isMobile) {
    await firstPick.tap();
  } else {
    await firstPick.focus();
    await expect(firstPick).toHaveAttribute('data-active', 'true');
    await firstPick.press('Enter');
  }
  await expect(page.getByLabel('Choose neighborhood')).toHaveValue(selectedId!);
  await page.getByRole('button', { name: 'Zoom to matches', exact: true }).click();
  await expect(map.locator('[data-neighborhood-id]')).toHaveCount(88);
  await page.getByRole('button', { name: 'Fit all neighborhoods', exact: true }).click();
  const markerPosition = await firstPick.boundingBox();
  const mapPosition = await map.boundingBox();
  expect(markerPosition!.x).toBeGreaterThanOrEqual(mapPosition!.x);
  expect(markerPosition!.x + markerPosition!.width).toBeLessThanOrEqual(mapPosition!.x + mapPosition!.width);
  expect(markerPosition!.y).toBeGreaterThanOrEqual(mapPosition!.y);
  expect(markerPosition!.y + markerPosition!.height).toBeLessThanOrEqual(mapPosition!.y + mapPosition!.height);
  expect(boundaryReads).toBe(1);
  await map.screenshot({ path: testInfo.outputPath('report-map.png') });
});

test('map failures preserve usable points and can be retried without reloading scoring', async ({ page }) => {
  const state = await mockApi(page);
  let failBoundaries = true;
  let failTiles = true;
  await page.route('**/rest/v1/rpc/get_neighborhood_map', route => failBoundaries
    ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: boundaryFixture() }));
  await page.route('https://tile.openstreetmap.org/**', route => failTiles
    ? route.abort() : route.fulfill({ contentType: 'image/svg+xml', body: tileFixture }));
  await page.goto('/');
  await signIn(page);
  await page.getByRole('button', { name: 'Generate report', exact: true }).click();
  await expect(page.getByText('Street map tiles could not load.', { exact: false })).toBeVisible();
  await expect(page.getByText('Neighborhood boundaries are unavailable.', { exact: false })).toBeVisible();
  await expect(page.locator('.geo-map [data-neighborhood-id]')).toHaveCount(88);
  failBoundaries = false;
  failTiles = false;
  await page.getByRole('button', { name: 'Retry boundaries', exact: true }).click();
  await page.getByRole('button', { name: 'Retry street map', exact: true }).click();
  await expect(page.locator('.geo-map path.leaflet-interactive')).toHaveCount(88);
  await expect(page.locator('.geo-map .leaflet-tile-loaded').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry boundaries', exact: true })).toHaveCount(0);
  expect(state.scoringReads).toBe(1);
});


test('all 88 rank with every priority; rent bounds are disclosed and disappear in buy mode', async ({ page }, testInfo) => {
  const state = await mockApi(page);
  await page.goto('/'); await signIn(page);
  await expect(page.getByText('88 of 88 neighborhoods can be ranked.')).toBeVisible();
  await expect(page.getByText('6 neighborhoods include conservative source-derived estimates.', { exact: false })).toBeVisible();
  for (const mode of ['Fully remote', 'Office / offer mode']) {
    await page.getByRole('button', { name: mode, exact: true }).click();
    for (const tenure of ['Buy', 'Rent']) {
      await page.getByRole('button', { name: tenure, exact: true }).click();
      await expect(page.getByText('88 of 88 neighborhoods can be ranked.')).toBeVisible();
    }
  }
  await page.getByRole('button', { name: 'Generate report', exact: true }).click();
  await expect(page.getByText('88 / 88', { exact: true })).toBeVisible();
  await page.getByLabel('Choose neighborhood').selectOption('7');
  const detail = page.locator('#neighborhood-evidence');
  await expect(detail.getByText('Exact median unavailable.', { exact: false })).toBeVisible();
  await expect(detail.getByRole('link', { name: 'City / ACS source' })).toHaveAttribute('href', /6-Gross-Rent-2024.pdf/);
  await page.screenshot({ path: testInfo.outputPath('all-88-report.png'), fullPage: true });
  await page.getByRole('button', { name: 'Adjust priorities', exact: true }).click();
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(page.getByText('5 neighborhoods include conservative source-derived estimates.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Continue with factual report', exact: true }).click();
  await page.getByLabel('Choose neighborhood').selectOption('7');
  await expect(detail.getByRole('complementary', { name: 'Conservative ranking inputs' })).toHaveCount(0);
  expect(state.aiRequests.length).toBe(1);
});

test('expired bounds leave six areas unranked rather than pretending full coverage', async ({ page }) => {
  await mockApi(page, { expiredBounds: true });
  await page.goto('/'); await signIn(page);
  await expect(page.getByText('82 of 88 neighborhoods can be ranked.')).toBeVisible();
  await page.getByRole('button', { name: 'Continue with factual report', exact: true }).click();
  await expect(page.getByText('82 / 88', { exact: true })).toBeVisible();
  await page.getByLabel('Choose neighborhood').selectOption('7');
  await expect(page.locator('#neighborhood-evidence').getByRole('complementary', { name: 'Conservative ranking inputs' })).toHaveCount(0);
});
