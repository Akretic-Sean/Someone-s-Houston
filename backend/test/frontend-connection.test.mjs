import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionConfig, loadConnectionConfig } from '../tools/check-frontend-connection.mjs';
const url = 'https://hknzivrgihnqzvsafkkr.supabase.co';
const env = { VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' };
const missing = () => { throw Object.assign(new Error('not found'), { code: 'ENOENT' }); };
test('frontend connection rejects admin keys, placeholder keys and foreign destinations before fetching', () => {
  for (const key of ['sb_secret_never_use', 'sb_publishable_...', '', 'legacy.jwt']) assert.throws(() => connectionConfig({ ...env, VITE_SUPABASE_PUBLISHABLE_KEY: key }, 'test'));
  assert.throws(() => connectionConfig({ ...env, VITE_SUPABASE_URL: 'https://example.org' }, 'test'));
  assert.equal(connectionConfig(env, 'test').url, url);
});
test('frontend check uses Vite env precedence and does not borrow backend env silently', async () => {
  const files = { '.env': `VITE_SUPABASE_URL=${url}\nVITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_base`,
    '.env.local': 'VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_local',
    '.env.production': 'VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_production' };
  const read = async path => files[String(path).split('/').at(-1)] ?? missing();
  assert.equal((await loadConnectionConfig({ env: {}, read })).publishableKey, 'sb_publishable_local');
  assert.equal((await loadConnectionConfig({ env: {}, read, mode: 'production' })).publishableKey, 'sb_publishable_production');
  assert.equal((await loadConnectionConfig({ env, read })).publishableKey, 'sb_publishable_test');
  await assert.rejects(loadConnectionConfig({ env: { SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_backend' }, read: missing }));
});
test('explicit env-file opt-in can check backend configuration without claiming frontend configuration', async () => {
  const config = await loadConnectionConfig({ envFile: '.env', env, read: async () => `SUPABASE_URL=${url}\nSUPABASE_PUBLISHABLE_KEY=sb_publishable_backend` });
  assert.equal(config.publishableKey, 'sb_publishable_backend');
  assert.match(config.source, /does not verify/);
  await assert.rejects(loadConnectionConfig({ mode: '../../file', env }));
});
