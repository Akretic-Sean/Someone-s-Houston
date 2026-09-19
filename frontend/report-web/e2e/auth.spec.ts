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

async function mockApi(page: Page, options: { failLogout?: boolean; expiredSession?: boolean; sendStatus?: number; aiStatus?: number; degrade?: boolean } = {}) {
  const state = { scoringReads: 0, failLogout: options.failLogout ?? false, otpRequests: [] as Record<string, unknown>[],
    sendStatus: options.sendStatus ?? 200, aiRequests: [] as Record<string, any>[] };
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
      return route.fulfill({ json: { payload: scoringFixture(), generatedAt: new Date().toISOString(), narrative: {
        status: options.degrade ? 'degraded' : 'generated', text: options.degrade ? null : 'Your selected priorities favor these relative matches.',
        expiresAt: new Date(Date.now() + 3600000).toISOString(), facts: [{ id: 'match_1', label: 'Computed match', value: 'Neighborhood 1', source: 'Verified scoring evidence' }],
      } } });
    }
    if (url.pathname.endsWith('/otp')) {
      state.otpRequests.push(route.request().postDataJSON());
      return route.fulfill({ status: state.sendStatus, json: state.sendStatus === 200 ? {} : { msg: 'Email unavailable', code: 'over_email_send_rate_limit' } });
    }
    if (url.pathname.endsWith('/verify')) {
      const input = route.request().postDataJSON();
      expect(input.type).toBe('email');
      return input.token === '123456'
        ? route.fulfill({ json: session(input.email) })
        : route.fulfill({ status: 403, json: { code: 'otp_expired', msg: 'Invalid code' } });
    }

    if (url.pathname.endsWith('/token')) {
      const input = route.request().postDataJSON();

      if (options.expiredSession) {
        return route.fulfill({ status: 400, json: { code: 'invalid_credentials', msg: 'Invalid login credentials' } });
      }
      return route.fulfill({ json: session(input.email) });
    }
    if (url.pathname.endsWith('/logout')) return state.failLogout
      ? route.fulfill({ status: 500, json: { msg: 'Temporary failure' } })
      : route.fulfill({ status: 204 });
    if (url.pathname.endsWith('/user')) return route.fulfill({ json: session().user });
    if (url.pathname.endsWith('/get_neighborhood_scoring_data')) {
      state.scoringReads++;
      return route.fulfill({ json: scoringFixture() });
    }
    return route.fulfill({ status: 503, json: { message: 'Detailed evidence unavailable in auth fixture' } });
  });
  return state;
}

async function requestCode(page: Page, email = 'recruiter@example.test') {
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Continue with email', exact: true }).click();
  await expect(page.getByLabel('Email code', { exact: true })).toBeVisible();
}

async function signIn(page: Page, email = 'recruiter@example.test') {
  await requestCode(page, email);
  await page.getByLabel('Email code', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Verify and continue', exact: true }).click();
}

test('login gates scoring; logout clears generated reports before the next account', async ({ page }) => {
  const state = await mockApi(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Continue with email', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Google/ })).toHaveCount(0);
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
  expect(state.scoringReads).toBe(0);
  await requestCode(page);
  expect(state.otpRequests[0].create_user).toBe(true);
  await page.getByLabel('Email code', { exact: true }).fill('000000');
  await page.getByRole('button', { name: 'Verify and continue', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('That code is invalid or has expired. Try again or request a new code.');
  expect(state.scoringReads).toBe(0);
  await page.getByLabel('Email code', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Verify and continue', exact: true }).click();
  await expect(page.getByText('88 of 88 neighborhoods can be ranked.')).toBeVisible();
  await page.getByRole('button', { name: 'Fully remote', exact: true }).click();
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await page.getByRole('button', { name: 'Generate report', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Top neighborhood matches' })).toBeVisible();
  await expect(page.getByText('Commute is excluded in fully remote mode.', { exact: false })).toBeVisible();
  expect(state.scoringReads).toBe(1);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue with email', exact: true })).toBeVisible();
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
  await expect(page.getByRole('button', { name: 'Continue with email', exact: true })).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
  state.failLogout = false;
  await signIn(page);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue with email', exact: true })).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
});

test('unrefreshable stored session returns to login without loading report data', async ({ page }) => {
  const state = await mockApi(page, { expiredSession: true });
  await page.addInitScript(({ key, value }) => { localStorage.setItem(key, JSON.stringify(value)); }, { key: storageKey, value: session('expired@example.test', true) });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Continue with email', exact: true })).toBeVisible();
  expect(state.scoringReads).toBe(0);
});

test('new accounts require a verified code and resend respects the cooldown', async ({ page }) => {
  const state = await mockApi(page);
  await page.clock.install();
  await page.goto('/');
  await requestCode(page, 'new@example.test');
  expect(state.otpRequests[0]).toMatchObject({ email: 'new@example.test', create_user: true });
  await expect(page.getByRole('button', { name: /Resend code in/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Verify and continue' })).toBeDisabled();
  await page.clock.fastForward(61000);
  await page.getByRole('button', { name: 'Resend code', exact: true }).click();
  await expect.poll(() => state.otpRequests.length).toBe(2);
  await page.getByRole('button', { name: 'Use another email' }).click();
  await expect(page.getByRole('button', { name: /Send code in/ })).toBeDisabled();
  expect(state.scoringReads).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('email rate limiting and delivery failures never pretend a code was sent', async ({ page }) => {
  const state = await mockApi(page, { sendStatus: 429 });
  await page.clock.install();
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('new@example.test');
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await expect(page.getByRole('alert')).toContainText('Please wait a minute');
  await expect(page.getByLabel('Email code', { exact: true })).toHaveCount(0);
  await page.clock.fastForward(61000);
  state.sendStatus = 400;
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await expect(page.getByRole('alert')).toContainText('We couldn’t send your code');
  state.sendStatus = 200;
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await expect(page.getByLabel('Email code', { exact: true })).toBeVisible();
  expect(state.scoringReads).toBe(0);
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
  expect(state.aiRequests[1].facts).toBeUndefined();
  expect(state.aiRequests[0].requestId).not.toBe(state.aiRequests[1].requestId);
  await page.screenshot({ path: testInfo.outputPath('ai-report.png'), fullPage: true });
  await page.getByRole('button', { name: 'Adjust priorities', exact: true }).click();
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Neighborhood report', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Supabase default email link establishes a session without a password', async ({ page }) => {
  await mockApi(page);
  const auth = session();
  const fragment = new URLSearchParams({ access_token: auth.access_token, refresh_token: auth.refresh_token,
    expires_in: '3600', token_type: 'bearer', type: 'magiclink' });
  await page.goto('/#' + fragment.toString());
  await expect(page.getByRole('heading', { name: 'Configure and generate' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/access_token=/);
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
