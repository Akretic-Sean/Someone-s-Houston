# Connect frontend features to the live backend

Start here for teammate/Claude integration. Read `CLAUDE.md`, [the API contract](api.md) and [the scoring method](scoring-matrix.md). Pull the current shared branch into your normal feature branch without discarding changes. Reuse the existing frontend data and authentication layers; do not merge unrelated PRs automatically.

## Copy-paste task

> Connect the frontend features I request to the existing Supabase backend. Read CLAUDE.md, docs/frontend-backend-handoff.md and docs/api.md first. Preserve teammate changes and the existing login flow. For neighborhood ranking, load get_neighborhood_access_scoring_data once and pass its complete source-bounded envelope to scoreNeighborhoodsWithEstimates in shared/scoring-estimates.mjs; do not invent another formula or use mock scores. Bind rent/buy, office, airport, weights and remote mode to that function. Load detailed evidence only for selected IDs, and retain source dates, estimate disclosures, missing values and expiry handling. Keep route minutes, safety tiers, taxes and unsupported personal financial claims unavailable. Preserve automatic factual reporting when AI is unavailable and the private saved-report flow; show save failures separately from report generation and do not claim sharing or delivery. Run the connection preflight, scoring tests and frontend build, verify the acceptance cases in this handoff, and report what actually passed. Ask for configuration only if the publishable key is missing; do not create a new project or use admin credentials.

Narrow the task by appending “Connect only [scoring / map / evidence cards / facilities / current alerts].” These reads do not require a custom API server or an agent MCP installation.

## Ready now versus remaining work

**Optional family/transit/crime cards:** the additive [expanded-context API](expanded-context.md) reuses housing/school evidence and adds METRO schedule summaries plus historical 2024 offense counts. The report displays historical public-safety context separately from the eight-category score. Fetch only for the selected neighborhood; failures must not block report generation. Rebuild/reconnect the local MCP to discover its seven read-only tools.

**Implemented:** public profiles for 88 neighborhoods, boundaries, eight facility inventories, current weather/gauges, detailed eight-category evidence, a compact scoring-data RPC and a deterministic relative ranking model. The frontend recomputes from cached evidence and includes private saved reports with owner-specific RLS. Production saving must be verified separately; implemented code and passing mocked tests do not certify a successful deployed save.

**All-88 report UI:** preview, factual generation and AI generation use the complete
`get_neighborhood_access_scoring_data` envelope (`base.model_version: "houston-access-v2"`) and shared
`scoreNeighborhoodsWithEstimates`. The six affected areas show conservative-input
badges, source ranges and links; missing observations remain null. Cached results
expire on base or estimate deadlines. The AI request includes
`scoringPolicy: "source-bounded-v1"` and `facilityPolicy: "nearby-3mi-v1"`; do not feed its bounded payload into the old
strict scorer. See [all-88 integration](all-88-frontend-guide.md).

**AI flow:** `report-flow` authenticates confirmed users, extracts optional notes for review, loads authoritative evidence and computes rankings server-side, then produces a validated explanation. Reuse `src/data/reportFlow.ts`. Notes never silently change the ranking controls. Quota exhaustion, quota-service failure or narration failure returns a factual report where evidence remains valid; a rejected or failed quota check never calls a paid model. The browser also falls back through its validated public-data client after an AI request failure. Neither path invents or revives expired evidence. See [hackathon release instructions](hackathon-release.md) and the [API contract](api.md#authenticated-ai-report-flow).

**Private report history:** `src/data/savedReports.ts` saves report configuration and its generation snapshot to `saved_reports` using the signed-in session. Owner-only select/insert/update policies protect those rows. Reopening restores saved preferences and recalculates with current evidence; the original snapshot remains stored privately. A failed save leaves the report view usable and offers retry. Confirm a deployed save/reload and cross-account isolation before claiming production persistence is verified.

**Not implemented:** public shareable reports or `/reports` endpoints, a separate private candidate-record API, driving/transit times, tax/take-home calculations, personal salary standing, lead delivery or safety tiers. Existing public-read policies must never be reused for candidate data.

**Listing Watch:** its optional dialog is preserved and receives the actual ranked shortlist. The watch service is not configured in this build; submission is disabled and nothing is sent. Its `session-…` correlation ID is not a saved-report ID. The scoring RPC does not schedule watches or send email. See [the separate watch integration contract](api.md#optional-listing-watch-integration).

## Configuration and first check

Use ignored `frontend/report-web/.env.local` (or the app's existing env setup):

```dotenv
VITE_SUPABASE_URL=https://hknzivrgihnqzvsafkkr.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<the project's sb_publishable_ key>
```

Obtain the publishable key from existing local configuration, the project owner, or Dashboard → Project Settings → API Keys. It is a browser credential, not an admin key. Never use `sb_secret_`/service-role credentials or commit/log real env files and keys. Supabase organization membership and developer MCP OAuth are unnecessary for these reads.

Use Node.js **22.12+** (tested environment: 24.14.1). From repository root:

```sh
npm --prefix backend ci --ignore-scripts
npm --prefix backend test
npm --prefix backend run test:frontend
npm --prefix frontend/report-web ci
npm --prefix frontend/report-web test
npm --prefix frontend/report-web run build
npm --prefix frontend/report-web run dev
```

The preflight reads the frontend's development env files in Vite order, then process variables; it does not silently borrow backend configuration. Use literal env values; variable expansion is not simulated. It checks public responses, canonical IDs, CORS and important unknowns without writes or key logging. For production-mode local configuration, append `-- --mode production` to `test:frontend`.

Set the same two variables in the deployment's **frontend build environment**, then rebuild/redeploy; Vite captures them at build time. A local preflight/build is not proof of deployed configuration or rendered UI behavior. Backend maintainers may run `npm run test:frontend -- --env-file .env` from `backend/`, but that explicitly tests backend env credentials rather than the frontend/deployment configuration.

## Reads and caching

All requests use the base URL above and `apikey: <publishable key>`; POST also needs `Content-Type: application/json`. Do not put a publishable key in a user bearer-token header. An existing Supabase JS client can call the same RPCs with its normal session handling. Anonymous and authenticated public reads are supported.

| UI need | Request | Cache / interpretation |
| --- | --- | --- |
| Current whole-cohort ranking | `POST /rest/v1/rpc/get_neighborhood_access_scoring_data`, `{}` | All 88 rows in a source-bounded envelope, model `houston-access-v2`. Cache ≤1 hour and respect base/estimate expiry; recalculate locally. |
| Profiles / housing facts | `GET /rest/v1/neighborhood_profiles?select=*&order=neighborhood_id.asc&limit=88` | Array of 88 profiles; cache 24 hours. |
| Boundary map | `POST /rest/v1/rpc/get_neighborhood_map`, `{}` | GeoJSON with 88 boundaries; cache 24 hours and join by `properties.neighborhood_id`. |
| Detailed selected evidence | `POST /rest/v1/rpc/get_neighborhood_evidence`, `{"p_neighborhood_id":62}` | Object; read `neighborhoods[0]`, verify its ID. Cache ≤1 hour per ID. |
| Facility markers | `POST /rest/v1/rpc/get_neighborhood_places`, `{"p_neighborhood_id":62,"p_category":null}` | GeoJSON plus source manifests; cache ≤1 hour. |
| Weather/gauges | `POST /rest/v1/rpc/get_current_context`, `{"p_neighborhood_id":62}` or `{}` | Check feed and feature expiry. Fetch only while needed, no more often than every five minutes. |

All RPCs are reads. REST uses `p_neighborhood_id`; local MCP tools use `neighborhood_id`. Integer IDs 1–88 are canonical. Evidence is not a profile array or a stored `Report` object. The [captured Midtown evidence](examples/neighborhood-evidence.example.json) is documentation, never a runtime fallback. Do not load the roughly 4 MB all-neighborhood detailed evidence response on every visitor or slider change.

## Ranking and screen mapping

Use `scoreNeighborhoodsWithEstimates` from `shared/scoring-estimates.mjs`, which validates the complete envelope and delegates to `shared/scoring.mjs`. The current RPC is defined in [the API contract](api.md#nearby-facility-scoring-current-report). The wrapper accepts all eight weights, `tenure`, `mode`, `office` and `airport`, and returns `ranked`, `unranked`, effective weights, category scores/contributions and explicit estimate disclosures. The original strict RPC/scorer and intermediate estimates RPC remain supported for older clients; they are not the current report path.

- Bind **Generate report** to that computation and use its real `ranked` shortlist, not IDs from `MOCK_REPORT`. Explanations come from measured factors and selected priorities.
- Input weights are 0–10 with defaults 8/7/6/5/7/8/6/7. Reject all-zero effective weights. Remote mode disables commute and renormalizes globally; show the effective weights.
- Rent/buy selects the matching housing estimate. Office IDs are `ion`, `downtown`, `energy`, `tmc`, `nasa`. Airport is `iah`, `hou` or `nearest`.
- A positive-weight category without a usable measurement or approved, unexpired conservative input makes that neighborhood unranked. Preserve its status and any bound disclosure; never change weights per neighborhood or replace missing with zero.
- Labels must describe the measurements: employment-hub/airport **proximity**, **grocery access** (dining not covered), and mapped flood **area share**. Do not display route minutes, flood/safety tiers or probability claims.
- Affordability is relative estimated housing cost. It is not a candidate budget, mortgage payment, personal salary standing or take-home calculation.
- Retain full precision during ranking. Scores are provisional 0–100 comparisons within this cohort, not independent ratings or guarantees.

The detailed evidence API intentionally retains null scores: it is a facts/provenance endpoint without user preferences. Separately calculated shared-model scores are now supported. Never cast the evidence object to an old mock report type to conceal a schema mismatch.

For selected cards, use `neighborhood.categories[id]` only when availability is `partial` or `reference_snapshot`, facts are non-null and `refresh_due_at` is future. Display `sources`, `limitations` and missing inputs alongside facts. Housing facts use `median_gross_rent_monthly_usd` and `median_home_value_usd`. Inventories provide counts and up to three `nearest_to_reference_point` records. Grocery details are in `food.inventories.grocery_stores`, not the old facility RPC's supported categories. Offices/airports are in `destinations`; map their actual evidence coordinates when showing their distances.

GeoJSON is longitude,latitude; Leaflet markers are latitude,longitude. Facility category overlap means summed records are not unique-site totals. Nearest records can lie outside the selected neighborhood. Distances use reference points rather than the candidate's address. Flood IDs 17,25,41,43,80 retain withheld exact shares; Hidden Valley (7) has no observed median rent. Their separate conservative ranking inputs must remain labeled. Safety tiers remain unavailable and outside the weighted model.

## Integration boundaries

Extend `frontend/report-web` rather than replacing the app. Reuse its env configuration, loading/retry conventions, map selection behavior and any existing auth client/session lifecycle. Do not overwrite another branch's auth work while merging the scoring change. Public reference reads do not require removal of an existing login gate.

Current P0 integration points:

| File within `frontend/report-web` | Responsibility |
| --- | --- |
| `src/data/scoringClient.mjs` and `.d.mts` | Bounded compact RPC read, schema validation, one-hour cache and in-flight coalescing. |
| `src/hooks/useScoringData.ts` | Loading/retry and refresh on visibility, focus or expiry. |
| `src/App.tsx` | Shared-model computation, input state, AI-to-factual fallback and private-save lifecycle. |
| `src/data/savedReports.ts` | Authenticated owner-scoped report list/upsert; save failures remain distinct from ranking failures. |
| `src/screens/CreateReport.tsx` | Direct preference configuration and optional reviewed notes extraction. |
| `src/screens/CandidateReport.tsx` | Ranked shortlist, all-neighborhood statuses, evidence and score breakdowns. |
| `src/components/NeighborhoodMap.tsx` | Leaflet boundary/reference-point map joined by canonical IDs; map failure does not discard rankings. |
| `src/watch/ListingWatchDialog.tsx`, `api.ts`, `types.ts` | Optional consented request to a separately configured watch webhook; currently unavailable. Uses canonical IDs from the ranked shortlist. |

The dashboard separates private saved reports from labeled synthetic candidate scenarios; opening a demo computes against current evidence without saving it. The app uses username/password access backed by Supabase Auth when configured. Session restoration gates the report workspace; signing out or changing accounts clears its in-session report state. Without configuration, login is absent and live report generation remains unavailable. Public reference reads still use the publishable key; private saves additionally require the authenticated owner's session and RLS policies.

The shared scoring module is browser-safe and dependency-free. Backend ingestion modules, Node-only helpers, env files and service credentials do not belong in the browser bundle. Backend validators/clients can be adapted deliberately, but importing their pinned `zod` dependency into another package unintentionally can break isolated builds.

## Acceptance and failure states

1. Run backend tests (including `backend/test/scoring.test.mjs`), frontend client tests, the connection preflight with frontend configuration and the frontend build. None substitutes for browser verification.
2. Confirm all 88 canonical IDs appear exactly once. With complete current evidence and valid approved bounds, the current report can rank all 88; verify rent and buy separately. Legacy strict counts differ and coverage can fall after source expiry.
3. Change weights, housing mode, office and airport; verify scores are recomputed from the same cached cohort and the report displays matching inputs. Remote mode removes commute; all-zero effective weights block generation.
4. Check Hidden Valley rent and the five flood gaps. Verify bound badges, source links/ranges and original null observations; expired bounds must leave affected positive-weight rows unranked. Safety tiers and route minutes stay unavailable.
5. Test missing/invalid key, network failure, malformed/incomplete payload, expired evidence, empty current feeds, rapid selection changes and hidden/resumed tabs. Never fall back to mocks. Clear/withhold expired results; rerun scoring when validity changes.
6. Verify map pan/zoom and input changes do not refetch large datasets. Coalesce in-flight reads, cache selected-ID evidence, and keep basemap attribution. All 88 areas can remain visible with their ranking status.
7. Preserve sign-in, session restoration and sign-out. Verify deployed build variables/network calls, a private save/reload, cross-account isolation and a failed-save retry separately. No shareable URL or lead delivery is implemented. Exercise AI quota/provider/network failures: valid evidence must still generate a clearly labeled factual report; invalid evidence must not become a fabricated result.
8. Report connected screens, limitations, files changed and checks actually run; explicitly identify browser/deployment checks that could not be performed.

Historical P0 validation recorded on 2026-09-19: 80 backend tests and seven frontend client tests passed, along with the frontend build, live API checks and SQL scoring/access guards. These are original-milestone results, not current test counts or certification of later saved-report deployments. Current CI also includes browser coverage for bounded scoring, nearby access, private dashboard flows and AI fallback. No check here certifies an external Listing Watch service.

## Optional agent MCP

The [Claude setup guide](claude-data-guide.md) describes seven local read-only tools, including scenario comparison in [the demo guide](backend-demo-proof.md). That comparison currently uses the legacy strict `get_neighborhood_scoring_data`/`scoreNeighborhoods` path; its rankings are not guaranteed to match the current nearby-access, bounded-input frontend. MCP remains optional for frontend work. Claude should preserve the returned model version and explain its facts/results rather than invent formulas.


## Source-backed inputs for all 88

The six missing rent/flood measurements have a separate, explicitly labeled conservative-input path. Keep every selected category; do not use the rejected global-exclusion approach. Read [the all-88 frontend walkthrough](all-88-frontend-guide.md) for the new RPC, shared wrapper, source bounds, badges, expiry and acceptance tests. Original observations and the strict model remain unchanged.


## Current nearby facility report

The current frontend reads `get_neighborhood_access_scoring_data` (source-bounded envelope,
base model `houston-access-v2`). The legacy RPCs above remain compatible for older
clients. Deploy the new migration and updated report-flow Edge Function before releasing
this frontend. Amenities/healthcare now use complete 3-mile inventories with distance
weighting; see [scoring-matrix.md](scoring-matrix.md). Detail inventory counts inside a
polygon are not the access counts; use `ScoredCategory.nearbyAccess` for the report cards.
