# Hou Match connections

The first [neighborhood reference layer](neighborhood-layer.md) is live in Supabase, with a read-only API and a local TypeScript MCP server for Claude. See the [backend setup](../backend/README.md) and [API contract](api.md). The [build plan](build-plan.md) still proposes hosted MCP/report services; the [backend data policy](backend-data-policy.md) defines relevant import windows.

Start with [Phase 0 data notes](data-notes.md) for source checks. The earlier [neighborhood data research](neighborhood-data-research.md) remains an exploratory source catalog; its broader product features are outside the current report scope.

## Connection inventory

| Connection | Purpose | Current state |
| --- | --- | --- |
| GitHub: `Akretic-Sean/Someone-s-Houston` | Shared code and pull requests | Public repository, renamed from `hou-match`; Oleggo1 has accepted write access |
| Houston Open Data | Discover datasets and read source data | Public CKAN API verified on 2026-09-19 |
| Cloudflare Workers | Proposed MCP/API hosting | Deployment not configured by this setup |
| Supabase project | Prepared reference data; future report storage | Existing `Someone-s-Houston`, `hknzivrgihnqzvsafkkr`, Free plan, `us-east-1` |
| Supabase agent connection | Let each developer's agent inspect the project | Backend owner's connection verified; partner authenticates separately |
| Supabase application connection | Public neighborhood reference reads | 88 profiles imported; REST and local MCP live tests passed |

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

Reuse the existing [Someone-s-Houston project](https://supabase.com/dashboard/project/hknzivrgihnqzvsafkkr). Its API URL is `https://hknzivrgihnqzvsafkkr.supabase.co`; no additional project or paid plan is needed for this data layer. Oleg's frontend and neighborhood MCP need only the URL and publishable key. Administrative/developer MCP access uses his own Supabase account separately; GitHub membership does not grant dashboard access.

Copy `backend/.env.example` to `backend/.env` locally and fill the publishable key. Add a secret key only for the backend owner's ingestion process. The neighborhood table has RLS plus explicit read-only grants; its publishable key can be used in the frontend. Secret keys bypass RLS and belong only on the server. See the backend README for tested commands.

Reference: [Supabase API keys](https://supabase.com/docs/guides/api/api-keys).

When creating tables for the Data API, include explicit grants for the roles and operations the application needs, enable RLS, and add matching policies in the same migration. Do not rely on default grants; project settings and creation dates can differ. Verify using the application's role/key as well as the privileged database connection. See [Supabase's updated table-access defaults](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).

## Agent connections

Connect the Supabase integration in your coding environment using your own Supabase login. Confirm project reference `hknzivrgihnqzvsafkkr` before database work.

For Claude Code, `.mcp.json.example` now has two entries: the product's local `hou-match-neighborhoods` tools (URL/publishable key), and optional developer `supabase` tools (OAuth). The project reference is filled in and the developer entry is read-only. Follow the backend README to build/configure the local connector, and use `/mcp` to authenticate the developer entry if needed. Keep tokens and real configuration outside Git.

This Supabase MCP connection is for developer tools. It is separate from the build plan's Houston Open Data MCP and Pitch MCP, which are product services. Application code uses the Supabase API/client library with runtime configuration.

Reference: [Supabase MCP setup and configuration](https://supabase.com/docs/guides/ai-tools/mcp).

## Handoff against the current build plan

1. Resolve the geography, freshness, and coverage gaps in `docs/data-notes.md`; choose the three or more portal datasets and matching boundaries before declaring Phase 0 complete.
2. Capture dated, versioned snapshots and reference inputs. Keep source periods separate from download times.
3. Agree on the report JSON contract in `docs/api.md`, including source dates, unavailable metrics, snapshot fallback, and report expiration, so Oleggo can build the page against a fixture.
4. Implement the shared TypeScript CKAN client, the read-only Open Data MCP, and deterministic scoring; the Pitch MCP calls the shared packages directly.
5. Extend the existing Supabase schema/importer for the remaining validated layers and report storage. The 88-row neighborhood table, read policies, initial import and local MCP are complete; proposed Workers hosting remains unconfigured.

Current proposed report flow: Houston/Census/reference inputs -> normalized, versioned data -> scoring -> Pitch MCP -> stored report JSON -> Oleggo's page. The neighborhood reference layer is available now; hosted MCP services and report storage are not yet implemented.
