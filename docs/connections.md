# Hou Match connections

This setup prepares data discovery and agent access while the application build plan is being written. It does not select the app framework, create database tables, or define the product's endpoints.

See [neighborhood data research](neighborhood-data-research.md) for the product-specific source shortlist, live API checks, and Supabase/MCP architecture proposal.

## Connection inventory

| Connection | Purpose | Current state |
| --- | --- | --- |
| GitHub: `Akretic-Sean/hou-match` | Shared code and pull requests | Public repository; Oleggo1 has accepted write access |
| Houston Open Data | Discover datasets and read source data | Public CKAN API verified on 2026-09-19 |
| Supabase project | Proposed database for selected, normalized data | Not created yet |
| Supabase agent connection | Let each developer's agent inspect the project | Backend owner's connection verified; partner authenticates separately |
| Application connection | Let the running backend use Supabase | Environment template ready; project values pending |

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

Create a project named `hou-match` in the intended Supabase organization. Choose its region alongside the backend host. Record the project reference and URL here once available. Set up Oleggo1's Supabase access separately if his agent needs database access; GitHub repository membership does not configure a Supabase connection.

Copy `backend/.env.example` to `backend/.env` locally. Fill the project reference, API URL, and publishable key. Add a secret key only to a backend process that requires privileged access. Publishable keys can be used in a frontend with appropriate Row Level Security policies; secret keys bypass RLS and belong only on the server. Exact framework-specific environment names are pending the build plan.

Reference: [Supabase API keys](https://supabase.com/docs/guides/api/api-keys).

When creating tables for the Data API, include explicit grants for the roles and operations the application needs, enable RLS, and add matching policies in the same migration. New projects no longer automatically grant access to new tables. Verify using the application's role/key as well as the privileged database connection. See [Supabase's updated table-access defaults](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).

## Agent connections

Connect the Supabase integration in your coding environment using your own Supabase login. Once the project exists, confirm the project reference before database work.

For Claude Code, copy `.mcp.json.example` to the ignored `.mcp.json`, set `SUPABASE_PROJECT_REF` in the environment that launches Claude, and authenticate with `claude /mcp` in a terminal. Alternatively, replace the variable in your local file with the actual project reference. The template limits access to that project and begins with read-only database, docs, and development tools. OAuth handles login; do not put access tokens in the repository. When backend migrations are ready, configure the backend agent for write access to the intended development project.

The MCP connection is for developer tools. The running application uses the Supabase API/client library with its runtime configuration.

Reference: [Supabase MCP setup and configuration](https://supabase.com/docs/guides/ai-tools/mcp).

## Handoff when the build plan lands

1. Choose source datasets and resource IDs from `backend/data/houston-catalog.json`.
2. Record the Supabase project reference and region, then verify the connection with a table listing.
3. Define application tables and RLS policies as versioned migrations; agree on data refresh cadence and source attribution.
4. Implement a small repeatable import of the chosen records, then document the frontend/backend contract in `docs/api.md`.
5. Configure deployment environment variables after the framework and host are chosen.

Working proposal: Houston source data -> backend import/normalization -> Supabase -> application API/frontend. The final plan should decide which data needs caching and whether the frontend will query Supabase directly under RLS or use backend endpoints.
