# Hou Match backend

Frontend teammates: use [the frontend/backend handoff](../docs/frontend-backend-handoff.md) for a ready-to-use agent prompt, environment setup, field mappings and connection checks. From the repository root, `npm --prefix backend run test:frontend` verifies the existing frontend configuration against the public data endpoints; it does not modify the database.

Owner: @Akretic-Sean. TypeScript on Node.js 22.9+ (tested on 24.14.1; use 22.12+ for the frontend). Supabase provides the hosted database and REST API; the neighborhood MCP runs locally over stdio. A shared deterministic model generates in-session neighborhood rankings. Cloudflare hosting and stored/shared reports remain proposed.

## Ready now

- Supabase project: [`Someone-s-Houston`](https://supabase.com/dashboard/project/hknzivrgihnqzvsafkkr), reference `hknzivrgihnqzvsafkkr`, region `us-east-1`, Free plan verified 2026-09-19.
- API base: `https://hknzivrgihnqzvsafkkr.supabase.co`.
- `public.neighborhood_profiles`: 88 validated City records, public read-only, with source periods and missing-value flags.
- 88 PostGIS boundaries plus eight facility sources, joined once during import. Three read-only RPCs serve the map, neighborhood facilities and current conditions.
- NWS alerts and USGS water gauges refresh centrally every 15 minutes; expired data is withheld from current-condition reads.
- Eight report-priority categories and 704 precomputed evidence records, exposed through `get_neighborhood_evidence`.
- Compact `get_neighborhood_scoring_data()` read RPC for all 88 neighborhoods (approximately 162 kB), plus dependency-free `../shared/scoring.mjs` for browser/Node ranking. No per-slider API request or external provider call is needed. See [the scoring model](../docs/scoring-matrix.md).
- Shared cached clients: `src/neighborhoods.ts`, `src/context.ts` and `src/evidence.ts`. Five read-only Claude tools in `src/mcp.ts`.
- [Frontend/API contract](../docs/api.md), [facility provenance](../docs/neighborhood-context.md), [map integration/demo](../docs/map-integration.md), [live-feed operations](../docs/live-feeds.md).

## Install and test

From the repository root:

```sh
cd backend
npm ci --ignore-scripts
npm test
```

Copy `.env.example` to `.env`. Fill `SUPABASE_PUBLISHABLE_KEY` with this project's **publishable** key from Dashboard > Project Settings > API Keys. The project URL/reference are already in the example. Share the publishable key with Oleg outside Git; it is intended for public application reads. Dashboard/admin access is not required by the frontend or the neighborhood MCP. Never give them `SUPABASE_SECRET_KEY`.

```sh
npm run test:live
```

This tests all 88 profiles, context and category-evidence APIs through the real public API, checks that an anonymous insert is denied, and starts the actual five-tool stdio MCP process. It requires network access and the publishable key. Offline tests cover source validation, missing values, caching/expiry, publication behavior, refresh authorization, scoring and MCP discovery/calls. To run only the shared model tests from repository root: `node --test backend/test/scoring.test.mjs`.

`supabase/tests/` contains SQL checks for anonymous/authenticated access, RPC expiry, malformed imports and atomic publication rollback. Run them in the project's SQL Editor after seeding; every mutation is rolled back. These are plain SQL, not pgTAP suites. Local Docker/database reset testing has not been run.

## Refresh data

```sh
# Downloads only 88 selected records and centers; validates every economic value.
npm run data:prepare

# Backend owner only: add SUPABASE_SECRET_KEY to the ignored .env first.
# Validates again, skips an unchanged version, otherwise sends one atomic upsert.
npm run data:publish
```

Preparation needs no keys. Publishing accepts a modern `sb_secret_` key, never a frontend credential. The first production load was applied through the authenticated Supabase connection; a secret key has not been saved locally. Subsequent REST publishing is covered by mocked tests; the live API/MCP and database permissions were tested separately.

The importer selects IDs, names, income, home value, rent and WGS84 centers. It rejects missing/duplicate IDs, partial responses, invalid coordinates, negative sentinel estimates, and values that disagree with the verified 2024 City tables. Hidden Valley's missing rent remains `null`. A new ACS release needs a reviewed update of the reference file and period before publishing; an upstream edit timestamp does not establish a new data year.

Check for a new City release monthly or before a demo. Annual profiles are not scheduled hourly. Unchanged profile data causes no write and no new snapshot version. The importer uses timeouts and a bounded response; after a failure, rerun later. It never falls back to an older historical dataset automatically.

For boundaries and the eight reviewed facility sources:

```sh
# Downloads bounded current inventories and canonical polygons, without credentials.
npm run geo:prepare

# Backend owner only, with SUPABASE_SECRET_KEY in the ignored .env.
# Stages batches then atomically replaces each validated source.
npm run geo:publish
```

Run this manually after a reviewed source change or before a demo, not per visitor or every few minutes. Re-publish facilities after a boundary change; the API hides old memberships until rejoined. Publication preserves the last source if validation fails, consumes successful staging, and records boundary/source versions. It replaces that source's rows rather than retaining historical editions. The initial import used the authenticated Supabase connection; the REST publisher is tested with simulated staging failures and redirect rejection. School vintage changes require updating the reviewed source config.

Current conditions use a separate deployed Edge Function and active database Cron job. No local process needs to remain running. See [refresh deployment, authentication and maintenance](../docs/live-feeds.md). Basemap tiles are fetched by the frontend directly; do not upload tiles to Supabase.

## Claude Code / Desktop

The root `CLAUDE.md` supplies project data rules. Follow the [Claude handoff guide](../docs/claude-data-guide.md) to verify instruction loading, all five tools and correct interpretation in the partner's actual session. The [category-evidence guide](../docs/category-evidence.md) covers the screenshot's priorities, housing/FEMA/grocery preparation and atomic publication of 704 evidence rows.

Run `npm run build` before connecting. From the repository root, copy `.mcp.json.example` to the ignored `.mcp.json` and replace the local `SUPABASE_PUBLISHABLE_KEY` placeholder, or export that environment variable before launching Claude Code. The example already has this project's URL and reference. Claude Code runs the relative server path from the repository root. Use `/mcp` to inspect/connect it.

For Claude Desktop, add only the `hou-match-neighborhoods` entry to its MCP configuration, with an **absolute path** to `backend/dist/mcp.js` and literal URL/publishable-key environment values. Run Node directly; npm's stdout banner must not be used as the MCP transport.

Example prompts:

- "Use list_neighborhoods to find Midtown and show the source period."
- "Find neighborhoods with estimated median gross rent under $1,600. Explain what these figures do and do not mean."
- "Use get_neighborhood_amenities for Midtown (62), including the source dates."
- "Use get_current_conditions for regional weather alerts and gauges; explain any unavailable or expired data."
- "Use get_neighborhood_evidence for Midtown (62). Explain the eight priorities, source dates and missing inputs; preserve null route minutes and safety tier."

The five MCP tools return facts and source context. The separate shared model ranks neighborhoods using explicit preferences; no scoring MCP tool is added. Neither supplies driving times, safety tiers, tax calculations or saved reports. MCP has no arbitrary SQL or write tool. Caches last up to 24 hours for profiles, one hour for facilities/evidence, and 60 seconds for current conditions; expiry is rechecked on every read. Restart/reconnect after building to discover all five tools. Claude web/hosted connectors require a future HTTP deployment; this connector supports local MCP clients.

The optional `supabase` entry is the separate **developer** MCP: project-scoped, read-only and OAuth-authenticated with each developer's own Supabase account. It is not needed to consume neighborhood data.

## Database changes

The migration files match the migrations already applied to the hosted project. Do not replay them manually there. For future changes, use the pinned CLI version and review a new migration before applying it:

```sh
npx --yes supabase@2.117.0 migration new descriptive_change_name
```

RLS and explicit read grants protect each public data table. Only trusted ingestion receives insert/update privileges; staging and the Vault-backed refresh request stay private. PostGIS, pg_cron and pg_net support spatial joins and central refresh. No Realtime subscription, vector index, tile storage bucket, extra database instance or paid plan was created.

## Earlier catalog discovery utility

Python 3.10+ is only needed for the independent CKAN discovery utility:

```sh
python tools/houston_data.py status
python tools/houston_data.py search housing --limit 5
```

See [source priorities](../docs/source-shortlist.md) and [bounded data policy](../docs/backend-data-policy.md) before adding another import.
