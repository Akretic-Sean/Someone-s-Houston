import test from 'node:test';
import assert from 'node:assert/strict';
import { createRelocationClient, parseRelocationContext } from '../dist/relocation.js';
import { publishRelocationContext } from '../dist/publish-relocation-context.js';
import { createServer } from '../dist/mcp.js';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';

const prepared='2026-09-19T20:00:00Z', expiry='2026-09-26T00:00:00Z';
const source = { source_id:'test', source_url:'https://example.org/source', source_period:'2024', source_checked_at:prepared };
const unavailable = () => ({ availability:'unavailable', facts:null, source:null, refresh_due_at:null });
function body() {
  return {schema_version:1, neighborhood_id:62, evaluated_at:prepared, scoring_effect:'none',
    housing:unavailable(),schools:unavailable(),transit:unavailable(),
    reported_crime:{availability:'historical_snapshot', refresh_due_at:expiry, source,
      facts:{year:2024,source_neighborhood_name:'MIDTOWN',counts:{aggravated_assault:2,robbery:1,burglary:0,motor_vehicle_theft:null,theft_from_motor_vehicle:3}}},
    safety:{tier:null,availability:'unavailable',weighted:false},
    official_links:{crime:'https://example.org/crime',schools:'https://example.org/school',childcare:'https://example.org/childcare'},
  };
}
test('context preserves historical labels and missing values; rejects wrong scope and fabricated rates', () => {
  const parsed=parseRelocationContext(body(),62);
  assert.equal(parsed.reported_crime.facts.counts.motor_vehicle_theft,null);
  assert.throws(()=>parseRelocationContext(body(),7));
  const malformed=body(); malformed.reported_crime.availability='reference_snapshot';
  assert.throws(()=>parseRelocationContext(malformed,62),/historical/);
  const rates=body(); rates.reported_crime.facts.counts.rate_per_1000=3;
  assert.throws(()=>parseRelocationContext(rates,62));
  const hidden=body(); hidden.reported_crime.availability='needs_refresh';
  assert.throws(()=>parseRelocationContext(hidden,62),/exposes facts/);
});
test('coalesces/copies cached reads, expires at source deadline and never falls back on outage', async()=>{
  let now=Date.parse(expiry)-1000, calls=0, failure=false;
  const client=createRelocationClient({url:'https://test.supabase.co',publishableKey:'sb_publishable_test',now:()=>now,
    fetch:async()=>{calls++; if(failure)throw new Error('outage');return new Response(JSON.stringify(body()));}});
  const [a,b]=await Promise.all([client.getRelocationContext({neighborhood_id:62}),client.getRelocationContext({neighborhood_id:62})]);
  assert.equal(calls,1);a.reported_crime.facts.counts.robbery=999;assert.equal(b.reported_crime.facts.counts.robbery,1);
  now+=1001; failure=true;
  await assert.rejects(client.getRelocationContext({neighborhood_id:62}),/outage/);
  assert.equal(calls,2);
  await assert.rejects(client.getRelocationContext({neighborhood_id:0}));
});
test('withholds facts if server expiry is past and blocks admin credentials', async()=>{
  const client=createRelocationClient({url:'https://test.supabase.co',publishableKey:'sb_publishable_test',now:()=>Date.parse(expiry)+1,
    fetch:async()=>new Response(JSON.stringify(body()))});
  const result=await client.getRelocationContext({neighborhood_id:62});
  assert.equal(result.reported_crime.availability,'needs_refresh');assert.equal(result.reported_crime.facts,null);
  assert.throws(()=>createRelocationClient({url:'https://test.supabase.co',publishableKey:'sb_secret_test'}));
});
test('publisher refuses incomplete/duplicate cohorts before network access', async()=>{
  let calls=0;const options={url:'https://test.supabase.co',secretKey:'sb_secret_test',fetch:async()=>{calls++;return new Response('{}');}};
  await assert.rejects(publishRelocationContext({schema_version:1,snapshots:[{source:{source_id:'metro_gtfs'},rows:[]}]},options));
  assert.equal(calls,0);
});
test('new MCP tool calls the bounded context client without altering original tools', async t=>{
  let args;
  const server=createServer({list:async()=>[]},undefined,undefined,{getRelocationContext:async input=>{args=input;return body();}});
  const client=new Client({name:'relocation-test',version:'1.0'});
  const [a,b]=InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a),client.connect(b)]);
  t.after(async()=>{await client.close();await server.close();});
  const result=await client.callTool({name:'get_neighborhood_relocation_context',arguments:{neighborhood_id:62}});
  assert.equal(result.isError,undefined);assert.deepEqual(args,{neighborhood_id:62});assert.equal(result.structuredContent.scoring_effect,'none');
});
