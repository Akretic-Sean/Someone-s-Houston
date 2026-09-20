# Documentation

Start with the [project overview](../README.md) for the product, live URLs and architecture. This index separates implementation guides from early planning and dataset research.

## Build and connect

| Guide | Purpose |
| --- | --- |
| [Frontend setup](../frontend/README.md) | Run the React report app and configure the Vercel build |
| [Backend setup](../backend/README.md) | Prepare data, run checks and connect local MCP clients |
| [Frontend/backend handoff](frontend-backend-handoff.md) | Current bindings, teammate/agent instructions and acceptance checks |
| [API contract](api.md) | Implemented reads and report function; proposed endpoints are marked separately |
| [Authentication](auth-setup.md) | Username accounts, session handling and recovery limits |
| [Private saved reports](private-saved-reports.md) | Owner-scoped persistence, current-evidence reopening and synthetic demo separation |
| [Release checklist](hackathon-release.md) | Database, Edge Function and frontend deployment sequence |

## Understand the evidence

| Guide | Purpose |
| --- | --- |
| [Scoring methodology](scoring-matrix.md) | Current nearby-access model and the separate legacy model |
| [All-88 scoring](all-88-frontend-guide.md) | Official source bounds, retained nulls and required disclosures |
| [Category evidence](category-evidence.md) | Measurements and provenance for the eight report priorities |
| [Expanded context](expanded-context.md) | Housing detail, schools, dated transit and historical reported crime |
| [Map integration](map-integration.md) | Canonical IDs, GeoJSON and facility map reads |
| [Shared data rules](data-instructions.md) | Source periods, freshness, missing values and interpretation boundaries |

## Operate and verify

- [Data operations](data-operations.md): publication, refresh ownership and monitoring.
- [Live feeds](live-feeds.md): expiring weather alerts and gauge observations.
- [Model layer](model-layer.md): structured extraction/narration and provider configuration.
- [Claude/MCP guide](claude-data-guide.md): seven local read-only tools and interpretation checks.
- [Backend comparison and performance](backend-demo-proof.md): repeatable strict-MCP comparisons and bounded performance evidence.

The report frontend requests `get_neighborhood_access_scoring_data`, uses `houston-access-v2`, and preserves the `source-bounded-v1` envelope. Legacy scoring RPCs and the MCP scenario tool retain their documented strict/proximity behavior. Do not interchange those outputs or claim identical rankings.

## Planning and research

The [original build plan](build-plan.md), [source shortlist](source-shortlist.md), [neighborhood research](neighborhood-data-research.md), [matrix readiness](matrix-readiness.md) and [future datasets](next-data-sources.md) record decisions and opportunities from development. Their dated status statements are not a deployment inventory. Use current code, migrations and the implementation guides above to establish shipped behavior; verify deployed services separately.
