import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { createNeighborhoodClient, filterNeighborhoods, filterSchema, type NeighborhoodProfile } from './neighborhoods.js';
import { createContextClient, amenitiesInputSchema, conditionsInputSchema, type ContextClient } from './context.js';
import { createEvidenceClient, evidenceInputSchema, type EvidenceClient } from './evidence.js';

const interpretation = 'City of Houston neighborhood estimates from ACS 2020-2024, not current listings. Gross rent is monthly; income is annual household income, not an individual salary. Coordinates are polygon centers, not driving times. Missing values are unknown. These fields alone do not establish flood risk, school quality, safety, or the best neighborhood for a family.';

export function createServer(client: { list(): Promise<NeighborhoodProfile[]> }, context?: Pick<ContextClient, 'getAmenities' | 'getCurrentConditions'>, evidence?: EvidenceClient) {
  const server = new McpServer({ name: 'hou-match-neighborhoods', version: '0.1.0' });
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const respond = async (select: (rows: NeighborhoodProfile[]) => object) => {
    try {
      const rows = await client.list();
      const output = { interpretation, data_version: rows[0]!.data_version, ...select(rows) };
      return { content: [{ type: 'text' as const, text: JSON.stringify(output) }], structuredContent: output };
    } catch {
      return { isError: true, content: [{ type: 'text' as const, text: 'Neighborhood data is unavailable or invalid. Retry later; do not invent estimates.' }] };
    }
  };
  server.registerTool('list_neighborhoods', {
    description: 'Find Houston Super Neighborhoods by name or estimated median rent/home-value ceilings. Results are ID-ordered, not ranked; missing estimates are excluded from budget filters. Use limit 88 for all neighborhoods.',
    inputSchema: filterSchema, annotations,
  }, args => respond(rows => filterNeighborhoods(rows, args)));
  server.registerTool('get_neighborhood', {
    description: 'Get one Houston Super Neighborhood by official ID (1-88), including source, data period, map center and any missing-estimate flags.',
    inputSchema: z.object({ neighborhood_id: z.number().int().min(1).max(88) }).strict(), annotations,
  }, args => respond(rows => ({ neighborhood: rows.find(r => r.neighborhood_id === args.neighborhood_id) })));
  const contextResponse = async (read: () => Promise<object>) => {
    try {
      const output = await read();
      return { content: [{ type: 'text' as const, text: JSON.stringify(output) }], structuredContent: output };
    } catch {
      return { isError: true, content: [{ type: 'text' as const, text: 'Neighborhood context is unavailable or invalid. Do not interpret missing data as zero, no alerts, or evidence of safety.' }] };
    }
  };
  server.registerTool('get_neighborhood_amenities', {
    description: 'Get facility counts, short records and source provenance for one Super Neighborhood. Optional category; limit up to 100. Inventory does not establish current opening status, school quality, or travel time.',
    inputSchema: amenitiesInputSchema, annotations,
  }, args => contextResponse(async () => {
    if (!context) throw new Error('Context client is not configured.');
    return context.getAmenities(args);
  }));
  server.registerTool('get_current_conditions', {
    description: 'Get current NWS alert and USGS gage context, optionally restricted by Super Neighborhood. Returns freshness status and at most 20 short records total, without geometry. Unavailable/stale is not zero or safe; gage levels are provisional operational context, not neighborhood flood risk.',
    inputSchema: conditionsInputSchema, annotations,
  }, args => contextResponse(async () => {
    if (!context) throw new Error('Context client is not configured.');
    return context.getCurrentConditions(args);
  }));
  server.registerTool('get_neighborhood_evidence', {
    description: 'Read evidence for all eight current report priorities: affordability, commute, flood context, local amenities, fitness, food, airport access and healthcare. Includes sources, dates, missing inputs and explicit availability. No scores or safety tiers are implemented; distances are not travel times. Use this before drafting a relocation recommendation.',
    inputSchema: evidenceInputSchema, annotations,
  }, args => contextResponse(async () => {
    if (!evidence) throw new Error('Evidence client is not configured.');
    return evidence.getEvidence(args);
  }));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const client = createNeighborhoodClient({ url: process.env.SUPABASE_URL ?? '', publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '' });
    const context = createContextClient({ url: process.env.SUPABASE_URL ?? '', publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '' });
    const evidence = createEvidenceClient({ url: process.env.SUPABASE_URL ?? '', publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '' });
    await createServer(client, context, evidence).connect(new StdioServerTransport());
  } catch {
    console.error('Cannot start neighborhood MCP. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY; run npm run build.');
    process.exitCode = 1;
  }
}
