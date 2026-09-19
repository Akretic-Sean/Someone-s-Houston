# Hou Match connections

The [build plan](build-plan.md) proposes TypeScript, two MCP servers on Cloudflare Workers, and shared data/scoring packages. Supabase is now selected for prepared neighborhood data and saved reports. The [backend data policy](backend-data-policy.md) defines relevant import windows and the fast report path. No application runtime has been implemented yet.

Start with [Phase 0 data notes](data-notes.md) for source checks. The earlier [neighborhood data research](neighborhood-data-research.md) remains an exploratory source catalog; its broader product features are outside the current report scope.

## Connection inventory

| Connection | Purpose | Current state |
| --- | --- | --- |
| GitHub: `Akretic-Sean/hou-match` | Shared code and pull requests | Public repository; Oleggo1 has accepted write access |
| Houston Open Data | Discover datasets and read source data | Public CKAN API verified on 2026-09-19 |
| Cloudflare Workers | Proposed MCP/API hosting | Deployment not configured by this setup |
| Supabase project | Selected relational/spatial data and report storage | Hou Match project not created yet |
| Supabase agent connection | Let each developer's agent inspect the project | Backend owner's connection verified; partner authenticates separately |
| Supabase application connection | Runtime access for imports and report services | Environment template only; no application connection |

## Houston: ready to use

The live portal reports CKAN 2.9.11. Status, catalog search, resource lookup, and DataStore sampling responded successfully without credentials. The checked catalog had 94 datasets and 386 resources, of which 325 were marked DataStore-active. The committed metadata snapshot is a discovery aid; query the portal for current details.

Run from the repository root with Python 3.10 or newer; no packages need installing. Python is used only for this discovery utility and does not determine the backend stack.

```sh
python backend/tools/houston_data.py status
python backend/tools/houston_data.py search housing --limit 5
python backend/tools/houston_data.py dataset city-of-houston-median-household-income-and-median-housing-value
python backend/tools/houston_data.py sample 87dbbeba-91e3-4c81-a2a0-0e68a85770d5 --limit 2
```

The housing commands are examples, not a product dataset selection. The utility supports catalog metadata snapshots and bounded DataStore samples, with request timeouts and limited retries. It reads an exported `HOUSTON_DATA_BASE_URL` override if supplied; it does not load `.env` files.

Direct endpoints:

- Catalog search: `https://data.houstontx.gov/api/3/action/package_search?q=housing&rows=5`
- Dataset resources: `https://data.houstontx.gov/api/3/action/package_show?id=DATASET_SLUG`
- Resource metadata: `https://data.houstontx.gov/api/3/action/resource_show?id=RESOURCE_ID`
- Table sample: `https://data.houstontx.gov/api/3/action/datastore_search?resource_id=RESOURCE_ID&limit=5`

Check each resource's `format`, `url`, and `datastore_active` before choosing an importer. The catalog also includes links to other services. Inspect those services separately when selected. Record source license and attribution metadata alongside imported data.

References: [Houston Open Data](https://data.houstontx.gov/), [CKAN Action API](https://docs.ckan.org/en/2.9/api/), [CKAN DataStore API](https://docs.ckan.org/en/2.9/maintaining/datastore.html#the-datastore-api).

## Supabase project and runtime

Create a project named `hou-match` in the intended organization for normalized spatial data, prepared metrics, and reports. Organization, cost confirmation, and project creation remain pending. Choose its region alongside the backend host. Record the project reference and URL here once available. Set up Oleggo1's Supabase access separately if his agent needs database access; GitHub repository membership does not configure a Supabase connection.

Copy `backend/.env.example` to `backend/.env` locally. Fill the project reference, API URL, and publishable key. Add a secret key only to a backend process that requires privileged access. Publishable keys can be used in a frontend with appropriate Row Level Security policies; secret keys bypass RLS and belong only on the server. Runtime-specific configuration remains to be implemented.

Reference: [Supabase API keys](https://supabase.com/docs/guides/api/api-keys).

When creating tables for the Data API, include explicit grants for the roles and operations the application needs, enable RLS, and add matching policies in the same migration. New projects no longer automatically grant access to new tables. Verify using the application's role/key as well as the privileged database connection. See [Supabase's updated table-access defaults](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).

## Agent connections

Connect the Supabase integration in your coding environment using your own Supabase login. Once the project exists, confirm the project reference before database work.

For Claude Code, copy `.mcp.json.example` to the ignored `.mcp.json`, set `SUPABASE_PROJECT_REF` in the environment that launches Claude, and authenticate with `claude /mcp` in a terminal. Alternatively, replace the variable in your local file with the actual project reference. The template limits access to that project and begins with read-only database, docs, and development tools. OAuth handles login; do not put access tokens in the repository. When backend migrations are ready, configure the backend agent for write access to the intended development project.

This Supabase MCP connection is for developer tools. It is separate from the build plan's Houston Open Data MCP and Pitch MCP, which are product services. Application code uses the Supabase API/client library with runtime configuration.

Reference: [Supabase MCP setup and configuration](https://supabase.com/docs/guides/ai-tools/mcp).

## Handoff against the current build plan

1. Resolve the geography, freshness, and coverage gaps in `docs/data-notes.md`; choose the three or more portal datasets and matching boundaries before declaring Phase 0 complete.
2. Capture dated, versioned snapshots and reference inputs. Keep source periods separate from download times.
3. Agree on the report JSON contract in `docs/api.md`, including source dates, unavailable metrics, snapshot fallback, and report expiration, so Oleggo can build the page against a fixture.
4. Implement the shared TypeScript CKAN client, the read-only Open Data MCP, and deterministic scoring; the Pitch MCP calls the shared packages directly.
5. Configure the Supabase project, migrations/access policies, bounded import jobs, and proposed Workers host. Verify the application's access separately from the developer MCP connection.

Current proposed flow: Houston/Census/reference inputs -> normalized, versioned data -> scoring -> Pitch MCP -> stored report JSON -> Oleggo's report page. This setup has not deployed either MCP server or created a report store.
