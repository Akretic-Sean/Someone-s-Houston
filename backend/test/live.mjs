import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createNeighborhoodClient } from '../dist/neighborhoods.js';

const url = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const client = createNeighborhoodClient({ url, publishableKey });
const start = performance.now();
const rows = await client.list();
assert.equal(rows.length, 88);
assert.equal(rows.find(r => r.neighborhood_id === 7).median_gross_rent, null);
assert.equal(rows.find(r => r.neighborhood_id === 62).median_gross_rent, 1811);
const firstMs = Math.round(performance.now() - start);
const cachedStart = performance.now();
await client.list();
const cachedMs = Math.round(performance.now() - cachedStart);

// Read-only security check: an unknown body must fail permissions, never upsert an existing record.
const denied = await fetch(`${url}/rest/v1/neighborhood_profiles`, {
  method: 'POST', headers: { apikey: publishableKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ neighborhood_id: 89 }),
  signal: AbortSignal.timeout(15_000),
});
assert.ok([401, 403].includes(denied.status), `Anonymous write must be denied, got ${denied.status}`);

const mcp = new Client({ name: 'hou-match-live-test', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('../dist/mcp.js', import.meta.url))],
  env: { SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: publishableKey },
});
try {
  await mcp.connect(transport);
  assert.equal((await mcp.listTools()).tools.length, 2);
  const result = await mcp.callTool({ name: 'get_neighborhood', arguments: { neighborhood_id: 62 } });
  assert.equal(result.isError, undefined);
  assert.equal(JSON.parse(result.content[0].text).neighborhood.name, 'MIDTOWN');
} finally { await mcp.close(); }
console.log(JSON.stringify({ rows: rows.length, json_bytes: Buffer.byteLength(JSON.stringify(rows)), first_read_ms: firstMs, cached_read_ms: cachedMs, anonymous_write_status: denied.status, mcp: 'passed' }));
