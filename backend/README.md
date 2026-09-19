# Backend

Owner: @Akretic-Sean.

Add the backend application here. Record the selected framework, prerequisites, install command, development command, and verification commands as soon as they exist.

Document endpoints in `../docs/api.md` and provide `.env.example` with placeholder configuration when needed.

## Connections and data discovery

Start with [the connection guide](../docs/connections.md). A dependency-free Python utility in `tools/houston_data.py` can search Houston's public catalog and sample DataStore resources. See `data/houston-catalog.json` for the dated metadata inventory.

From the repository root:

```sh
python backend/tools/houston_data.py status
python backend/tools/houston_data.py search housing --limit 5
```

Use Python 3.10+ for this utility; the application runtime remains to be selected. `.env.example` contains placeholders for the future Supabase project, and `.mcp.json.example` at the repo root prepares Claude Code's project-scoped connection.
