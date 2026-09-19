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

function scoringFixture() {
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
      return { neighborhood_id: id, name: `Neighborhood ${id}`, reference_point: { latitude: 29.75 + index / 1000, longitude: -95.37 },
        categories: Object.fromEntries(CATEGORY_IDS.map(category => [category, {
          availability: 'partial', refresh_due_at: new Date(Date.now() + 86400000).toISOString(),
          evidence_version: 'browser-test-v1', metrics: metrics[category],
        }])),
      };
    }),
  };
}

async function mockApi(page: Page, options: { failLogout?: boolean; expiredSession?: boolean } = {}) {
  const state = { scoringReads: 0, failLogout: options.failLogout ?? false };
  // Every Supabase request is intercepted: these tests never create users or send mail.
  await page.route('https://hknzivrgihnqzvsafkkr.supabase.co/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/token')) {
      const input = route.request().postDataJSON();
      if (options.expiredSession || input.password === 'incorrect') {
        return route.fulfill({ status: 400, json: { code: 'invalid_credentials', msg: 'Invalid login credentials' } });
      }
      return route.fulfill({ json: session(input.email) });
    }
    if (url.pathname.endsWith('/logout')) return state.failLogout
      ? route.fulfill({ status: 500, json: { msg: 'Temporary failure' } })
      : route.fulfill({ status: 204 });
    if (url.pathname.endsWith('/signup')) return route.fulfill({ json: { user: session().user, session: null } });
    if (url.pathname.endsWith('/user')) return route.fulfill({ json: session().user });
    if (url.pathname.endsWith('/get_neighborhood_scoring_data')) {
      state.scoringReads++;
      return route.fulfill({ json: scoringFixture() });
    }
    return route.fulfill({ status: 503, json: { message: 'Detailed evidence unavailable in auth fixture' } });
  });
  return state;
}

async function signIn(page: Page, email = 'recruiter@example.test', password = 'correct-password') {
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test('login gates scoring; logout clears generated reports before the next account', async ({ page }) => {
  const state = await mockApi(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  expect(state.scoringReads).toBe(0);
  await signIn(page, 'recruiter@example.test', 'incorrect');
  await expect(page.getByRole('alert')).toHaveText('Invalid login credentials');
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
  await signIn(page, 'second@example.test');
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

test('signup confirmation keeps the workspace gated', async ({ page }) => {
  const state = await mockApi(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Email', { exact: true }).fill('new@example.test');
  await page.getByLabel('Password', { exact: true }).fill('correct-password');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByText('Check your email to confirm your account, then sign in.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  expect(state.scoringReads).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
