# Claude data handoff

The goal is to make correct data use easy to verify. Project instructions explain the rules; bounded tools, schema validation, expiry checks and database permissions enforce the parts code can enforce. No prompt file guarantees that an agent will interpret every result correctly.

**Connecting frontend screens:** start with [the frontend/backend handoff](frontend-backend-handoff.md). It includes a copy-paste implementation prompt, exact field mapping, branch-aware integration points and `npm --prefix backend run test:frontend`. MCP setup below is optional for frontend development; browser reads use REST/RPC.

## Oleg's one-time setup

1. Pull the branch containing this guide, or `main` after it merges. Read root `CLAUDE.md` and `docs/api.md`.
2. From `backend/`, run `npm ci --ignore-scripts` and `npm run build`.
3. Follow `backend/README.md` to configure the project URL and **publishable** key locally. Copy `.mcp.json.example` to the ignored `.mcp.json` at repository root; either export `SUPABASE_PUBLISHABLE_KEY` before starting Claude Code or replace that placeholder in the local file. Do not commit real local configuration. Having a key only in `backend/.env` does not export it into Claude Code's parent environment.
4. Start Claude Code from the repository root, use `/context` to confirm the root instructions loaded, and `/mcp` to inspect/connect `hou-match-neighborhoods`. Reconnect after rebuilding the server. All five product tools should be visible, including `get_neighborhood_evidence`.
5. From `backend/`, run `npm run test:live` with the key in the ignored `.env`. This launches the real MCP server and checks public API access. The optional `supabase` developer connector uses separate personal OAuth; it is unnecessary for consuming the neighborhood tools.

For Claude Desktop, the repository `CLAUDE.md` is not an assumed automatic memory mechanism. Supply the concise data rules in the relevant project/task instructions and configure the local stdio server with the absolute `backend/dist/mcp.js` path, as described in the backend README. Claude web/hosted MCP access is not deployed by this project.

See Anthropic's [project instructions documentation](https://code.claude.com/docs/en/memory) and [MCP/project configuration documentation](https://code.claude.com/docs/en/mcp). The `CLAUDE.md` file is shared in Git; it does not install or authenticate a connector on another person's computer.

## How to tell whether Claude is using it correctly

Run this in Oleg's connected Claude session and inspect the tool calls as well as the answer:

> Read CLAUDE.md and docs/api.md. Using hou-match-neighborhoods, resolve Midtown's official ID, get its eight-category evidence, list its parks and check current conditions. Also check Hidden Valley's rent and Eldridge/West Oaks flood coverage. Explain which report fields remain unsupported. Use actual tool results, cite observation periods separately from check time, keep missing/stale values unavailable, and never convert straight-line distances to drive minutes. Do not use mock report values as fallbacks.

Expected behavior with the current reference edition:

| Check | Correct behavior |
| --- | --- |
| Name/ID | Resolves Midtown to official ID 62; does not cast a frontend slug to an integer |
| Economic period | Identifies ACS 2020–2024; monthly gross rent is an estimate, not a current asking price |
| Missing estimate | Hidden Valley (7) rent remains unavailable; no zero or invented value |
| Facilities | Includes inventory source/period, and does not infer hours, admissions or school quality |
| Current conditions | Checks availability and timestamps; no gauge result does not mean flood-safe |
| Category evidence | Uses the screenshot's eight IDs, identifies grocery coverage as a SNAP subset and preserves source limitations |
| Flood gaps | ID17 has withheld exposure percentages; no invented zero or low-risk label |
| Distances and safety | Drive minutes and safety tier stay null; source-backed locations are not travel-time or safety evidence |
| Report status | Says taxes, routing and stored reports are unavailable; the five MCP tools supply facts, while the separately implemented shared model produces provisional neighborhood scores |
| Access | Uses product read tools; never asks for a service-role key just to read public data |

Source values and counts can change. Test interpretation rules, not an indefinitely fixed gauge count. The existing automated tests cover invalid inputs, missing estimates, cached/expired feeds, bounded results and denied public writes. These verify the software path; the conversational smoke check verifies Oleg's actual agent is connected and following the instructions. That remote Claude session has not been tested by this setup.

## Add a source without creating another ambiguous tool

For each approved dataset, implement this complete path:

`official source → bounded validated import → versioned Supabase rows → specific read API/MCP tool → dated explanation`

The source contract should specify the source URL, geography, units, observation/effective period, check time, missing values, permissible interpretations and refresh/expiry rules. Keep canonical neighborhood IDs explicit. A tool result should expose these fields alongside the values, plus availability and a data version; do not return an unexplained number.

Use narrow operations such as `get_city_comparison`, `get_rent_benchmark` or `get_flood_context` once their datasets and methods are implemented. These are **proposed names**, not available tools. Their input schemas should restrict geography/year/bedroom counts instead of giving the product agent arbitrary SQL. Keep returned records bounded and leave large raw geometries out of ordinary language-model responses.

Ranking belongs in tested deterministic code. The implemented `houston-proximity-v1` model in `shared/scoring.mjs` runs in both browser and Node against `get_neighborhood_scoring_data`; see [the scoring contract](scoring-matrix.md). Claude gathers explicit preferences and explains returned scores, assumptions and limitations. It must not invent another formula, fill missing positive-weight categories, infer driving minutes or create safety/tax claims from free text. Financial calculations remain unimplemented.

For the frontend scoring handoff, ask:

> Load the compact scoring-data RPC using the existing publishable-key configuration. Use scoreNeighborhoods from shared/scoring.mjs with the selected weights, rent/buy mode, office and airport. Verify remote mode excludes commute, all-zero effective weights are rejected, and neighborhoods missing a positive-weight criterion remain unranked. Fetch detailed evidence only for selected neighborhoods. Run backend scoring tests, the frontend connection preflight and frontend build; distinguish actual browser/deployment checks from automated API checks. Do not claim report persistence, sharing, lead delivery or a new scoring MCP tool.

Keep recruiter transcripts, salary profiles and saved reports in separately authorized tables if those features are implemented. The public read policies for City/FEMA/Census reference data are not appropriate for candidate records.
