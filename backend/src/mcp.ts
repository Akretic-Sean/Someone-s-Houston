import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { createNeighborhoodClient, filterNeighborhoods, filterSchema, type NeighborhoodProfile } from './neighborhoods.js';

const interpretation = 'City of Houston neighborhood estimates from ACS 2020-2024, not current listings. Gross rent is monthly; income is annual household income, not an individual salary. Coordinates are polygon centers, not driving times. Missing values are unknown. These fields alone do not establish flood risk, school quality, safety, or the best neighborhood for a family.';

export function createServer(client: { list(): Promise<NeighborhoodProfile[]> }) {
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
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const client = createNeighborhoodClient({ url: process.env.SUPABASE_URL ?? '', publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '' });
    await createServer(client).connect(new StdioServerTransport());
  } catch {
    console.error('Cannot start neighborhood MCP. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY; run npm run build.');
    process.exitCode = 1;
  }
}
