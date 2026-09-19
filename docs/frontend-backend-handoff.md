# Connect frontend features to the live backend

This is the entry point for a teammate's Claude/agent. PR #6 supplies the backend contract, clients and instructions; its Supabase migration and data are already deployed. Work from a checkout containing this document. After the PR merges, pull current main into the teammate's normal feature branch without discarding their changes. Before it merges, integrate the PR's backend/docs changes locally according to the team's branch workflow. Do not merge unrelated remote PRs automatically.

## Copy-paste task

> Connect the frontend features I request to the existing Supabase backend. Read CLAUDE.md and docs/frontend-backend-handoff.md first, then follow docs/api.md. Inspect the current branch and reuse its data loaders, map and authentication. Implement the connections for the screens present in this checkout; preserve the UI and teammate changes. Use the configured publishable key, canonical neighborhood IDs and documented read APIs. Add the eight-category evidence layer, source labels, loading/error/partial/expired states and caching. Keep unsupported scores, safety tiers, financial calculations and route minutes unavailable; never fill them from mocks. Run the connection preflight and frontend build, verify the acceptance cases in the handoff, and report what is connected and what remains unsupported. Ask for configuration only if the publishable key is missing; do not create a new project, require MCP for browser reads, or use admin credentials.

To scope it narrowly, append: “For this change, connect only [map / housing / neighborhood evidence cards / facilities / current alerts].” These are independently usable reads; there is no requirement to build every section together.

## Ready now versus remaining backend work

**Ready:** public neighborhood profiles, canonical map boundaries, eight facility inventories, operational weather/gauges, and evidence for the eight screenshot categories. The browser calls Supabase directly. No custom API server, edge-function deployment, ingestion run, database migration or MCP installation is needed to consume these reads.

**Not implemented:** the proposed `/reports` service, candidate extraction, persistence/sharing of generated reports, scoring/ranking, actual travel-time routing, taxes/take-home comparison, lead delivery and safety tiers. Public data access does not grant permission to store candidate details in public tables. Preserve the frontend's existing login flow and keep private-data work separate.

## Configuration and first check

Use the existing project's values in the **ignored** `frontend/report-web/.env.local` (or reuse that app's existing env setup):

```dotenv
VITE_SUPABASE_URL=https://hknzivrgihnqzvsafkkr.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<the project's sb_publishable_ key>
```

The key is a browser application credential. Obtain it from existing local configuration, the project owner, or Supabase Dashboard → Project Settings → API Keys. Use a literal value and never substitute `sb_secret_`/service-role credentials. Do not put the real env file or keys in Git, prompts or logs. If the teammate has no key yet, this is the only required access handoff; Supabase organization membership and developer MCP OAuth are not required for these public reads.

From repository root:

Use Node.js **22.12+**, or the tested **24.14.1**. This covers both the backend check and the frontend build requirements.

```sh
npm --prefix backend ci --ignore-scripts
npm --prefix backend run test:frontend
npm --prefix frontend/report-web ci
npm --prefix frontend/report-web run dev
```

The preflight reads Vite's development env files in order (`.env`, `.env.local`, `.env.development`, `.env.development.local`) then process variables; it does not silently borrow backend configuration. Literal values are required; variable expansion is not simulated. It validates five data surfaces, map/profile IDs, browser CORS preflight, source-backed evidence and important null values without printing keys or writing to the database.

For a local production-mode check: `npm --prefix backend run test:frontend -- --mode production`. Configure the same two variables in the deployment's **frontend build environment**, then rebuild/redeploy. Vite captures them at build time; changing an env file requires restarting the dev server. A local check does not verify the deployed host's settings.

Backend maintainers can explicitly test an existing backend env file with `npm run test:frontend -- --env-file .env` from `backend/`. That tests the API using that file and explicitly does **not** certify the frontend/deployment configuration.

## Read APIs to choose from

Base URL is above. Raw fetch needs `apikey: <publishable key>`; POST also needs `Content-Type: application/json`. Do not use a publishable key as a user bearer JWT. An existing Supabase JS client may call the same RPCs and manage the signed-in user's token normally. Public reference reads support both anonymous and authenticated users.

| UI need | Request | Returned shape / caching |
| --- | --- | --- |
| Neighborhood selector, rent/value facts | `GET /rest/v1/neighborhood_profiles?select=*&order=neighborhood_id.asc&limit=88` | Array of all 88 profiles. Cache 24 hours; filter/select locally. |
| Real boundary map | `POST /rest/v1/rpc/get_neighborhood_map`, `{}` | GeoJSON FeatureCollection with 88 polygons; join by `properties.neighborhood_id`. Cache 24 hours. |
| Selected-neighborhood evidence/cards | `POST /rest/v1/rpc/get_neighborhood_evidence`, `{"p_neighborhood_id":62}` | Object with `category_definitions`, `safety`, and one item in `neighborhoods`. Cache ≤1 hour per ID. |
| Facilities/markers | `POST /rest/v1/rpc/get_neighborhood_places`, `{"p_neighborhood_id":62,"p_category":null}` | GeoJSON points plus source manifests. Cache ≤1 hour. Optional category uses the eight **facility** IDs in docs/api.md. |
| Current weather/gauges | `POST /rest/v1/rpc/get_current_context`, `{"p_neighborhood_id":62}` or `{}` | Object with `feeds`. Fetch only when needed, no more often than every five minutes while visible; recheck all expiry times. |

All RPCs are reads despite using POST. Inputs are named `p_neighborhood_id`; MCP tools use `neighborhood_id` instead. Evidence is **not** a profile array and is **not** the proposed `Report` object. Use `payload.neighborhoods[0]` for a single ID and check that its ID matches the request. The [captured evidence example](examples/neighborhood-evidence.example.json) shows the actual complete shape; it is documentation, never a runtime fallback.

Load profiles/map once, then evidence only for unique selected IDs. Three current example picks use IDs 62, 15, 24; these are a demo shortlist, not algorithmic recommendations. Keep canonical integer IDs alongside any UI string/slugs. API support for all 88 evidence records exists, but its roughly 4 MB response should not be fetched on every slider change. Input priority changes operate locally on cached data; they do not make a scoring engine exist.

## Field-to-screen mapping

Let `neighborhood = payload.neighborhoods[0]`, `category = neighborhood.categories[id]`, and `facts = category.facts`. Before using facts, require `availability` to be `partial` or `reference_snapshot`, non-null facts and a future `refresh_due_at`. A partial category can still contain null individual measurements. Preserve its `sources`, `missing_inputs` and `limitations` next to the displayed values.

| Category ID / UI | Exact facts to use | Correct display / what stays unavailable |
| --- | --- | --- |
| `afford` / housing | `median_gross_rent_monthly_usd`, `median_home_value_usd`, `housing_stock.structure_counts`, `housing_stock.bedroom_counts`, `housing_stock.year_built_counts`, `housing_stock.shares_pct` | “Estimated median monthly gross rent / home value · ACS 2020–2024.” Format USD. Do not turn home value into a mortgage payment or multiply separate housing shares into combined listing counts. |
| `commute` / selected office | `destinations.find(d => d.id === selectedOfficeId)`; its `straight_line_meters`, `drive_time_minutes`, `label`, `address`, `coordinates`, `note` | Match `ion`, `downtown`, `energy`, `tmc`, `nasa`. Label distance “straight-line from neighborhood reference point.” Minutes remain null; never divide distance by an assumed speed. |
| `flood` / mapped context | `availability` inside facts, `sfha_area_pct`, `annual_0_2_pct_area_pct`, `floodway_area_pct`, coverage fields, panel dates, `flags`, `definitions` | Require inner `availability === 'reference_summary'` and non-null values to display exposure shares. The 0.2% band excludes SFHA; floodway is already inside SFHA. No conversion to Clear/Caution/Avoid or a home-specific probability. |
| `amen` / nearby facilities | `inventories.libraries`, `.museums`, `.community_centers`, `.multi_service_centers` | Per-category counts and named nearby records, with source. Do not add overlapping categories into a claimed unique-site total. |
| `fit` / recreation | `inventories.parks`, `.community_centers` | Parks/centers only. Gym/trail coverage, entrances and walkability remain unavailable. |
| `food` / grocery | `inventories.grocery_stores` | Label “SNAP-authorized grocery inventory.” Dining is missing; do not invent restaurants or dietary suitability. |
| `air` / airport access | `destinations.find(d => d.id === selectedAirportId)`, where the ID is `iah` or `hou` | Airport proxy and straight-line distance. No drive minutes, current flights or noise score. |
| `health` / healthcare | `inventories.hospitals`, `.health_facilities`, `.multi_service_centers` | Facility locations, not insurance acceptance, available appointments or quality. |

Each inventory has `record_count_in_neighborhood` and `nearest_to_reference_point` (up to three records). Nearest records include `place_id`, `name`, `address`, `latitude`, `longitude`, `straight_line_meters`, `inside_neighborhood`, `source_id`, `location_method`. They may lie outside the selected neighborhood. Distances reference its center, not the candidate's address. Keep zero inventory records distinct from missing/null coverage.

When an office/airport marker accompanies an evidence distance, use that evidence destination's `coordinates`, not an old frontend constant. PR #7's hardcoded office points differ from the sourced proxies (including Ion and Energy Corridor). Preserve the existing office IDs/labels while aligning markers with the point actually used for the displayed distance.

Use `payload.category_definitions` for labels/default weights or the existing matching frontend definitions. Default raw weights are 8/7/6/5/7/8/6/7 (total 54), matching displayed 15/13/11/9/13/15/11/13%. Normalize nonnegative weights only when their sum is positive; if all sliders are zero, ask the user to choose a priority. This is a preference display, not a scoring formula. Category scores and `payload.safety.tier` are null.

## Extend the current frontend instead of rebuilding it

Checked on 2026-09-19: PR #7 `feat/live-neighborhood-data` and PR #9 `feat/report-web-login` are open and not yet in main. Inspect the current checkout because paths may change after merging. The items below describe integration points, not permission to merge those PRs remotely.

| Existing area | Integration action |
| --- | --- |
| PR #7 `src/config.ts`, `src/data/neighborhoodApi.ts`, `src/hooks/useNeighborhoods.ts` | Reuse the URL/key configuration, profile loader, hook and retry conventions. Add a separate typed evidence loader/hook with request coalescing, bounded response validation and per-ID cache. Validate a modern publishable key before network requests. |
| PR #7 `src/data/resolve.ts` and `src/types.ts` | Join by official integer `neighborhoodId`; deduplicate selected IDs. Do not keep all fields from `...pick` and label the resulting mock scores/claims live. Use a separate evidence-card model, or nullable/status-bearing fields in a coordinated type change. |
| PR #7 `src/screens/CandidateReport.tsx` | Its `useReport` still spreads `MOCK_REPORT`. Bind live facts explicitly; hide or label unsupported financial, ranking, commute, safety, services/momentum and narrative claims. No mock fallback after missing config or failed reads. Don't infer “standing” by comparing personal salary with neighborhood household income; they measure different things. |
| PR #7 `src/components/NeighborhoodMap.tsx` | Currently plots profile centers. Preserve its selection/hover behavior; wire `get_neighborhood_map` separately if polygons are wanted. Facility/current overlays are separate optional reads. GeoJSON is longitude,latitude; Leaflet marker arrays are latitude,longitude. `grocery_stores` is not a supported category of the old facility RPC: use food evidence for its nearest-store points. |
| PR #9 `src/lib/supabase.ts`, `src/screens/Login.tsx`, `src/App.tsx` | Preserve the singleton auth client, session restoration, auth subscription/cleanup, login gate, confirmation handling and sign-out. Preserve PR #7 connector state/expanded props too. Public data reads do not require removing a workspace login gate. |
| Main before those frontend PRs | Add equivalent small loaders/hooks within `frontend/report-web`; retain the design and scope requested by the teammate. Do not assume PR #7/PR #9 files already exist. |

The existing mock `Neighborhood`/`ResolvedNeighborhood` types require non-null scores, flood/safety tiers, commute text and ranked-card fields. The evidence RPC intentionally cannot satisfy them. Avoid unsafe casts (`as Report`, `as ResolvedNeighborhood`) to conceal the mismatch. Start with a small evidence view model holding official ID, category availability, typed facts, sources and missing inputs. Use a clearly labeled unranked shortlist until a tested scoring service is implemented. `why` text should be limited to supported facts plus the candidate's explicitly stated preferences.

Backend modules `src/neighborhoods.ts`, `src/context.ts`, `src/evidence.ts` show reusable validation/cache behavior. They depend on the backend's pinned zod version; don't create an accidental cross-package import that fails when only the frontend is installed/deployed. Raw fetch needs no new SDK. Adapt or package these deliberately, or extend the existing frontend client. Never import ingestion scripts, Node-only modules, `.env` files or service credentials into the browser bundle.

## States, sources and acceptance

- Render a loading state, then usable/partial data or a clear unavailable/error state with retry. A failed read must clear/withhold expired data. Ignore superseded requests after a selection change; deduplicate in-flight reads.
- `needs_refresh` evidence and `needs_rejoin` facilities are unavailable. Do not display old facts just because a previous request succeeded. Recheck deadlines on render/tab resume and set an expiry timer if the screen remains open. Current feeds also need per-feature expiry checks.
- Show source observation/effective periods separately from check timestamps. Unknown observation dates stay “unknown,” not today's date. Use text rendering for source strings; validate any rendered link protocol. Keep required map/data attribution.
- Keep browser auth and public reference reads separate from any future private report/candidate authorization. Never call staging/publishing/refresh functions from the browser.

Before declaring the integration complete:

1. Run `npm --prefix backend run test:frontend` using frontend configuration and `npm --prefix frontend/report-web run build`. The first command doesn't test rendered React UI.
2. Verify profiles and map join all 88 IDs; Midtown 62, Greater Heights 15 and Neartown–Montrose 24 resolve correctly. Hidden Valley 7 rent stays unavailable.
3. Show Midtown's evidence with source labels. IDs 17, 25, 41, 43, 80 must not show a flood-exposure percentage. Safety tier, score and drive minutes remain unavailable; changing the office selects the matching destination, not another hub.
4. In the browser, test missing/invalid key, API/network failure, expired evidence, an empty but current feed, unavailable/stale feeds, rapid neighborhood switching and hidden/resumed tabs. Do not use mock data to make these tests appear successful.
5. Confirm map pan/zoom and slider changes do not refetch large datasets; selected-ID reads coalesce/cache. Test both rent/buy labels and preserve candidate-selected weights/mode.
6. If login is present, verify signed-out gate, sign-in, session restoration and sign-out still work. Verify the deployed build's configuration and actual network requests separately; report any browser checks that could not be performed.
7. Summarize connected screens, source-backed fields, remaining unsupported outputs, files changed and checks actually run. Do not claim a complete recommendation engine or report persistence.

## Optional agent MCP

Claude can inspect real facts through the five local read-only tools in [the Claude setup guide](claude-data-guide.md). MCP is a development/agent convenience; the browser still uses REST/RPC. A teammate can implement the integration with fetch and the preflight alone. Root CLAUDE.md points here so a short request such as “Connect the neighborhood cards to the backend” discovers the correct contract.
