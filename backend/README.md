# Someone’s Houston backend

Frontend teammates: use [the frontend/backend handoff](../docs/frontend-backend-handoff.md) for a ready-to-use agent prompt, environment setup, field mappings and connection checks. From the repository root, `npm --prefix backend run test:frontend` verifies the existing frontend configuration against the public data endpoints; it does not modify the database.

Owner: @Akretic-Sean. TypeScript on Node.js 22.9+ (use 22.12+ for the frontend; CI uses Node 24). Supabase provides Postgres/PostGIS, Auth, public read APIs and authenticated Edge Functions. A shared deterministic model generates neighborhood rankings; AI optionally explains the computed results. The neighborhood MCP runs locally over stdio. Private saved reports are implemented; public share links are not.

**[Report app](https://app.astronix.io)** · [Public landing page](https://astronix.io) · [Architecture and usage](../README.md)

## Ready now

- Optional family/transit/historical-crime context: [integration and refresh guide](../docs/expanded-context.md). `get_neighborhood_relocation_context` is additive and does not change ranking. Its METRO service window needs a weekly reviewed refresh; the monitor warns before expiry.

- Supabase project: [`Someone-s-Houston`](https://supabase.com/dashboard/project/hknzivrgihnqzvsafkkr), reference `hknzivrgihnqzvsafkkr`, region `us-east-1`.
- API base: `https://hknzivrgihnqzvsafkkr.supabase.co`.
- `public.neighborhood_profiles`: 88 validated City records, public read-only, with source periods and missing-value flags.
- 88 PostGIS boundaries plus eight facility sources, joined once during import. Three read-only RPCs serve the map, neighborhood facilities and current conditions.
- NWS alerts and USGS water gauges refresh centrally every 15 minutes; expired data is withheld from current-condition reads.
- Eight report-priority categories and 704 precomputed evidence records, exposed through `get_neighborhood_evidence`.
- The report UI uses `get_neighborhood_access_scoring_data()` with model `houston-access-v2` and `scoreNeighborhoodsWithEstimates` in `../shared/scoring-estimates.mjs`. It retains all selected priorities and supplies disclosed conservative source-derived inputs for six neighborhoods, while preserving their missing observations. Nearby amenities and healthcare use a 3-mile radius with distance weighting. No per-slider API request or external provider call is needed. The original `get_neighborhood_scoring_data()` and strict `../shared/scoring.mjs` path remain available for audits and MCP scenario comparisons. See [the scoring model](../docs/scoring-matrix.md).
- Shared cached clients: `src/neighborhoods.ts`, `src/context.ts` and `src/evidence.ts`. Seven read-only MCP tools in `src/mcp.ts`: six fact/context reads and one deterministic scenario-comparison tool.
- Authenticated `report-flow` extracts optional notes and generates source-grounded explanations after deterministic scoring. AI quota/provider failures preserve a factual report; the browser has an independent fallback using validated public evidence. Invalid or expired evidence can still prevent generation.
- `saved_reports` stores report configuration and the original snapshot behind owner-scoped RLS. The frontend reports save failures explicitly; reopening recomputes saved preferences using current evidence. See [frontend behavior](../frontend/README.md).
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

This tests all 88 profiles, context and category-evidence APIs through the real public API, checks that an anonymous insert is denied, and starts the actual seven-tool stdio MCP process. It requires network access and the publishable key. Offline tests cover source validation, missing values, caching/expiry, publication behavior, refresh authorization, scoring and MCP discovery/calls. To run only the shared model tests from repository root: `node --test backend/test/scoring.test.mjs`.

GitHub Actions runs the complete Node, Python and database verification set on every PR. `supabase/tests/` contains plain SQL checks for anonymous/authenticated access, RPC expiry, malformed imports and atomic publication rollback. From the repository root, run `python backend/scripts/test_database.py` with Docker running to apply all migrations and execute every SQL suite in a disposable local database. No hosted database credentials are used. See [data operations](../docs/data-operations.md) for the full local commands, refresh ownership and GitHub issue monitoring.

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

The root `CLAUDE.md` supplies project data rules. Follow the [Claude handoff guide](../docs/claude-data-guide.md) to verify instruction loading, all seven tools and correct interpretation in the partner's actual session. The [category-evidence guide](../docs/category-evidence.md) covers the screenshot's priorities, housing/FEMA/grocery preparation and atomic publication of 704 evidence rows.

Run `npm run build` before connecting. From the repository root, copy `.mcp.json.example` to the ignored `.mcp.json` and replace the local `SUPABASE_PUBLISHABLE_KEY` placeholder, or export that environment variable before launching Claude Code. The example already has this project's URL and reference. Claude Code runs the relative server path from the repository root. Use `/mcp` to inspect/connect it.

For Claude Desktop, add only the `hou-match-neighborhoods` entry to its MCP configuration, with an **absolute path** to `backend/dist/mcp.js` and literal URL/publishable-key environment values. Run Node directly; npm's stdout banner must not be used as the MCP transport.

Example prompts:

- "Use list_neighborhoods to find Midtown and show the source period."
- "Find neighborhoods with estimated median gross rent under $1,600. Explain what these figures do and do not mean."
- "Use get_neighborhood_amenities for Midtown (62), including the source dates."
- "Use get_current_conditions for regional weather alerts and gauges; explain any unavailable or expired data."
- "Use get_neighborhood_evidence for Midtown (62). Explain the eight priorities, source dates and missing inputs; preserve null route minutes and safety tier."

Six MCP tools return facts and source context. The seventh, `compare_neighborhood_scenarios`, runs the strict shared model for two explicit preference sets; see [scenario comparisons](../docs/backend-demo-proof.md). These tools do not supply driving times, safety tiers, tax calculations or private saved reports. MCP has no arbitrary SQL or write tool. Caches last up to 24 hours for profiles, one hour for facilities/evidence, and 60 seconds for current conditions; expiry is rechecked on every read. Restart/reconnect after building to discover all seven tools. Claude web/hosted connectors require a future HTTP deployment; this connector supports local MCP clients.

The optional `supabase` entry is the separate **developer** MCP: project-scoped, read-only and OAuth-authenticated with each developer's own Supabase account. It is not needed to consume neighborhood data.

## Database changes

Migration files version the database schema, policies and RPCs. Check the target project's applied migration history before deploying; do not replay migrations manually on the hosted project. For future changes, use the pinned CLI version and review a new migration before applying it:

```sh
npx --yes supabase@2.117.0 migration new descriptive_change_name
```

RLS and explicit read grants protect each public reference table. Only trusted ingestion receives reference-data insert/update privileges; staging and the Vault-backed refresh request stay private. The separate `saved_reports` table permits authenticated users to read and write only their own records. PostGIS, pg_cron and pg_net support spatial joins and central refresh. The architecture does not require a Realtime subscription, vector index or tile storage bucket.

## Earlier catalog discovery utility

Python 3.10+ is only needed for the independent CKAN discovery utility:

```sh
python tools/houston_data.py status
python tools/houston_data.py search housing --limit 5
```

See [source priorities](../docs/source-shortlist.md) and [bounded data policy](../docs/backend-data-policy.md) before adding another import.

## Report model integration

The server-only AI SDK/OpenRouter extraction and narration boundary is documented
in [the model-layer guide](../docs/model-layer.md), including pinned versions,
Deno checks, secret configuration and the protected synthetic runtime check.
The report frontend calls this authenticated flow. Models organize optional notes and explain validated facts; they do not invent ranking scores. Server and browser fallback paths retain factual reports when AI is unavailable, subject to valid current evidence. Private report persistence uses `saved_reports` independently of model generation, so saving failures do not erase the report already generated. Public sharing and durable autonomous-agent memory are not implemented.

For all 88 with every selected priority retained, see [source-bounded scoring](../docs/all-88-frontend-guide.md). `npm run test:all-neighborhoods` checks `get_neighborhood_scoring_data_with_estimates` and the shared wrapper against live public data; it does not by itself certify the newer nearby-access RPC or deployed report UI. Never label conservative source-derived inputs as exact observations.
