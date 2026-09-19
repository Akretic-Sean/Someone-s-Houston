# Backend

Owner: @Akretic-Sean.

The [build plan](../docs/build-plan.md) proposes TypeScript, two MCP servers on Cloudflare Workers, and shared data/scoring packages. Supabase is selected for prepared metrics and saved reports; follow the [backend data policy](../docs/backend-data-policy.md) for bounded imports, freshness, retention, and fast report generation. Application implementation has not started in this branch. Record prerequisites and install, development, and verification commands as they become available.

Document endpoints in `../docs/api.md` and provide `.env.example` with placeholder configuration when needed.

## Connections and data discovery

Start with [Phase 0 data notes](../docs/data-notes.md) and [the connection guide](../docs/connections.md). A dependency-free Python utility in `tools/houston_data.py` can search Houston's public catalog and sample DataStore resources. See `data/houston-catalog.json` for the dated metadata inventory.

From the repository root:

```sh
python backend/tools/houston_data.py status
python backend/tools/houston_data.py search housing --limit 5
```

Use Python 3.10+ for this discovery utility; it does not determine the application runtime. `.env.example` and the repo-root `.mcp.json.example` prepare runtime and developer Supabase connections. They do not configure the proposed product MCP servers, and no Supabase project has been created for Hou Match.
