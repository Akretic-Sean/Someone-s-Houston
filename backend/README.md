# Hou Match backend

Owner: @Akretic-Sean. TypeScript on Node.js 22.9+ (tested on 24.14.1). Supabase provides the hosted database and REST API; the neighborhood MCP runs locally over stdio. Cloudflare hosting, report generation and scoring are still proposed.

## Ready now

- Supabase project: [`Someone-s-Houston`](https://supabase.com/dashboard/project/hknzivrgihnqzvsafkkr), reference `hknzivrgihnqzvsafkkr`, region `us-east-1`, Free plan verified 2026-09-19.
- API base: `https://hknzivrgihnqzvsafkkr.supabase.co`.
- `public.neighborhood_profiles`: 88 validated City records, public read-only, with source periods and missing-value flags.
- Shared cached client: `src/neighborhoods.ts`. Claude tools: `list_neighborhoods` and `get_neighborhood` in `src/mcp.ts`.
- [Frontend/API contract](../docs/api.md), [data provenance and costs](../docs/neighborhood-layer.md).

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

This tests all 88 rows through the real API, checks that an anonymous insert is denied, and starts the actual stdio MCP process to query Midtown. It requires network access and the publishable key. Nine offline tests cover validation, missing values, caching, bulk-publish behavior and MCP discovery/calls.

`supabase/tests/neighborhood_access.sql` also checks actual SELECT/INSERT/UPDATE/DELETE permissions for both anonymous and authenticated roles inside a rolled-back transaction. Run it in the project's SQL Editor after seeding; it was verified against the hosted project. It is plain SQL, not a pgTAP suite. Local Docker/database reset testing has not been run.

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

Check for a new City release monthly or before a demo. No scheduled job was enabled. These annual estimates do not need hourly updates. Unchanged data causes no write and no new snapshot version. The importer uses timeouts and a bounded response; after a failure, rerun later. It never falls back to an older historical dataset automatically.

## Claude Code / Desktop

Run `npm run build` before connecting. From the repository root, copy `.mcp.json.example` to the ignored `.mcp.json` and replace the local `SUPABASE_PUBLISHABLE_KEY` placeholder, or export that environment variable before launching Claude Code. The example already has this project's URL and reference. Claude Code runs the relative server path from the repository root. Use `/mcp` to inspect/connect it.

For Claude Desktop, add only the `hou-match-neighborhoods` entry to its MCP configuration, with an **absolute path** to `backend/dist/mcp.js` and literal URL/publishable-key environment values. Run Node directly; npm's stdout banner must not be used as the MCP transport.

Example prompts:

- "Use list_neighborhoods to find Midtown and show the source period."
- "Find neighborhoods with estimated median gross rent under $1,600. Explain what these figures do and do not mean."

The tools filter estimates and return source context; they do not rank families, calculate driving times, or produce relocation reports. They have no arbitrary SQL or write tool. Their cache lasts up to 24 hours within one running process. Claude web/hosted connectors require a future HTTP deployment; this connector supports local MCP clients.

The optional `supabase` entry is the separate **developer** MCP: project-scoped, read-only and OAuth-authenticated with each developer's own Supabase account. It is not needed to consume neighborhood data.

## Database changes

The migration files match the two migrations already applied to the hosted project. Do not replay them manually there. For future changes, use the pinned CLI version and review a new migration before applying it:

```sh
npx --yes supabase@2.117.0 migration new descriptive_change_name
```

RLS and explicit read grants are in the table migration. Only trusted ingestion receives insert/update privileges. The second migration removes application execution privileges from the project's pre-existing administrative auto-RLS event trigger, without disabling that trigger. No Realtime subscription, vector index, storage bucket, extra database instance or paid hosting was created.

## Earlier catalog discovery utility

Python 3.10+ is only needed for the independent CKAN discovery utility:

```sh
python tools/houston_data.py status
python tools/houston_data.py search housing --limit 5
```

See [source priorities](../docs/source-shortlist.md) and [bounded data policy](../docs/backend-data-policy.md) before adding another import.
