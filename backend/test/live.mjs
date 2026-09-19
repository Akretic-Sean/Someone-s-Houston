import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createNeighborhoodClient } from '../dist/neighborhoods.js';
import { createContextClient } from '../dist/context.js';
import { createEvidenceClient } from '../dist/evidence.js';

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
const context = createContextClient({ url, publishableKey });
const amenities = await context.getAmenities({ neighborhood_id: 62, limit: 5 });
assert.equal(amenities.neighborhood_id, 62);
assert.ok(amenities.returned_records <= 5);
const current = await context.getCurrentConditions({ limit: 2 });
assert.equal(current.feeds.length, 2);
assert.ok(current.returned_records <= 2);
const evidence = await createEvidenceClient({ url, publishableKey }).getEvidence({ neighborhood_id: 62 });
assert.equal(Object.keys(evidence.neighborhoods[0].categories).length, 8);
assert.equal(evidence.neighborhoods[0].categories.afford.facts.median_gross_rent_monthly_usd, 1811);
assert.equal(evidence.safety.tier, null);
assert.equal(evidence.neighborhoods[0].categories.commute.facts.destinations.length, 5);
assert.ok(evidence.neighborhoods[0].categories.commute.facts.destinations.every(d => d.drive_time_minutes === null));

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
  assert.equal((await mcp.listTools()).tools.length, 6);
  const result = await mcp.callTool({ name: 'get_neighborhood', arguments: { neighborhood_id: 62 } });
  assert.equal(result.isError, undefined);
  assert.equal(JSON.parse(result.content[0].text).neighborhood.name, 'MIDTOWN');
  const amenityResult = await mcp.callTool({ name: 'get_neighborhood_amenities', arguments: { neighborhood_id: 62, limit: 5 } });
  assert.equal(amenityResult.isError, undefined);
  assert.ok(JSON.parse(amenityResult.content[0].text).returned_records <= 5);
  const conditionsResult = await mcp.callTool({ name: 'get_current_conditions', arguments: { limit: 2 } });
  assert.equal(conditionsResult.isError, undefined);
  assert.equal(JSON.parse(conditionsResult.content[0].text).feeds.length, 2);
  const evidenceResult = await mcp.callTool({ name: 'get_neighborhood_evidence', arguments: { neighborhood_id: 62 } });
  const relocationResult = await mcp.callTool({ name: 'get_neighborhood_relocation_context', arguments: { neighborhood_id: 62 } });
  assert.equal(relocationResult.isError, undefined);
  assert.equal(relocationResult.structuredContent.neighborhood_id, 62);
  assert.equal(relocationResult.structuredContent.scoring_effect, 'none');
  assert.equal(evidenceResult.isError, undefined);
  assert.equal(JSON.parse(evidenceResult.content[0].text).profile_id, 'report-priorities-v1');
} finally { await mcp.close(); }
console.log(JSON.stringify({ rows: rows.length, json_bytes: Buffer.byteLength(JSON.stringify(rows)), first_read_ms: firstMs, cached_read_ms: cachedMs, anonymous_write_status: denied.status, amenity_status: amenities.availability, amenity_records: amenities.total_matches, current_feeds: current.feeds.map(f => ({ source_id: f.source_id, availability: f.availability })), mcp: 'passed' }));
