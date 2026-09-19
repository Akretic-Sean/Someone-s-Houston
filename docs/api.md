# Shared API contract

For implementation setup, frontend file/field mapping and acceptance checks, start with [the frontend/backend handoff](frontend-backend-handoff.md). The endpoint definitions below remain the source of truth.

Neighborhood profiles, maps, facility context and current-condition reads are **implemented and live**, 2026-09-19. The Supabase and local MCP sections below describe those available reads.

The merged frontend (`frontend/report-web`) currently renders mock reports. Its proposed report endpoints and payloads are preserved below under [Proposed report API](#proposed-report-api); they are not implemented or agreed backend endpoints. The frontend has not yet been connected to the live data APIs.

## Neighborhood profiles

- Base URL: `https://hknzivrgihnqzvsafkkr.supabase.co`.
- Method/path: `GET /rest/v1/neighborhood_profiles` (Supabase PostgREST).
- Header: `apikey: <SUPABASE_PUBLISHABLE_KEY>`. No account/login is required for this public City data. Never use an admin key in the frontend.
- Response: `200`, JSON array. Fetch all 88 records once, retain them in app state, and filter locally when priorities change.
- All neighborhoods: `?select=*&order=neighborhood_id.asc&limit=88`.
- Single neighborhood: `?select=*&neighborhood_id=eq.62` (still an array).
- Budget filter: `?select=*&median_gross_rent=lte.1600&order=neighborhood_id.asc&limit=88`. Null rent is excluded. This filters estimates, not listings.
- Browser CORS is provided by Supabase's Data API; no extra backend deployment is needed for these reads.

```js
// Load once when the app starts; keep the result in shared app/query state.
const url = new URL('/rest/v1/neighborhood_profiles', SUPABASE_URL);
url.search = new URLSearchParams({
  select: '*', order: 'neighborhood_id.asc', limit: '88'
});
const response = await fetch(url, {
  headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
  signal: AbortSignal.timeout(15000)
});
if (!response.ok) throw new Error(`Neighborhood data unavailable (${response.status})`);
const neighborhoods = await response.json();
if (neighborhoods.length !== 88) throw new Error('Incomplete neighborhood dataset');
```

For validation, request coalescing and a 24-hour in-memory cache, use `createNeighborhoodClient` from `backend/src/neighborhoods.ts` (or compiled `backend/dist/neighborhoods.js`). Create it once per app/process. It is browser-compatible and needs the backend's pinned `zod` dependency; raw REST needs no client library. Cache expiry triggers a new read; an expired cache is not silently served on error.

Example record from the initial import:

```json
{
  "neighborhood_id": 62,
  "name": "MIDTOWN",
  "median_household_income": 96473,
  "median_home_value": 388688,
  "median_gross_rent": 1811,
  "centroid_lat": 29.742253,
  "centroid_lon": -95.375334,
  "source_period_start": 2020,
  "source_period_end": 2024,
  "data_version": "coh-sn-2024-fc3656164c231d74",
  "source_url": "https://services.arcgis.com/NummVBqZSIJKUeVR/arcgis/rest/services/Super_Neighborhoods_Demographics/FeatureServer/2",
  "source_retrieved_at": "2026-09-19T17:01:51.387+00:00",
  "quality_flags": []
}
```

Money values are whole USD. Income is annual **household** income; gross rent is monthly; housing value is an estimated median, not a current listing. Centers support map markers and approximate straight-line distance, not driving time or parcel-level risk. IDs are the City's `POLYID`, 1–88, not ZIP codes. Join by ID rather than a loosely matched name.

Display under values: **City of Houston estimates • ACS 2020–2024**. Keep that distinct from retrieval time. When a value is `null`, show "Unavailable" and omit dependent calculations. Hidden Valley (`7`) currently has `median_gross_rent: null` and `quality_flags: ["rent_unavailable"]`. Never replace missing values with zero. This layer alone is not a complete neighborhood recommendation.

Errors use Supabase's JSON `{ "code", "message", "details", "hint" }` format where available. Handle 400 for invalid filters, 401/403 for missing/invalid credentials or forbidden writes, and network/429/5xx as temporary unavailability. Unknown IDs normally yield an empty array, not a 404. Show a retry state instead of fabricating data. Do not turn candidate text into raw SQL/filter expressions.

Anonymous and authenticated users can SELECT; INSERT/UPDATE/DELETE are denied. Candidate inputs and saved reports must use separately protected tables, without this public-read policy.

## Map, facilities and current conditions

All three RPCs use `POST /rest/v1/rpc/<name>` on the same base URL, headers `apikey: <SUPABASE_PUBLISHABLE_KEY>` and `Content-Type: application/json`. They are read-only even though PostgREST uses POST for arguments. No custom API server is required.

| RPC | JSON body | Response and suggested cache |
| --- | --- | --- |
| `get_neighborhood_map` | `{}` | WGS84 GeoJSON FeatureCollection, 88 boundaries, approximately 209 kB uncompressed. Cache 24 hours; render/filter locally. |
| `get_neighborhood_places` | `{ "p_neighborhood_id": 62, "p_category": null }` | GeoJSON points plus `sources` provenance. Required ID 1–88; optional category. Cache per ID/category for one hour. |
| `get_current_context` | `{}` or `{ "p_neighborhood_id": 62 }` | `{ checked_at, neighborhood_id, feeds }`. Regional or intersecting-neighborhood weather/gauge context. Poll no more often than five minutes, only while needed/visible; recheck expiry before display. |

```js
const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_neighborhood_places`, {
  method: 'POST',
  headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_neighborhood_id: 62, p_category: 'parks' }),
  signal: AbortSignal.timeout(15000)
});
if (!response.ok) throw new Error('Facility context unavailable');
const places = await response.json();
```

Categories: `parks`, `libraries`, `community_centers`, `hospitals`, `health_facilities`, `multi_service_centers`, `museums`, `schools`. Join feature `properties.source_id` to the matching `sources` entry. Read `source_period`, `source_checked_at`, `note`, `geometry_repair_count` and `availability`. Only `reference_snapshot` is usable; `needs_rejoin` means the boundary changed and this source needs republishing. Missing sources are unavailable, not zero facilities. Schools use the 2024–25 inventory; other inventories have unknown observation dates. A recently checked source is not proof that a facility is open today. Category overlap means counts are source records, not unique physical sites.

Geometry uses `[longitude, latitude]`. Facility points include `location_method`; park polygon representatives are not entrances. A park intersecting several neighborhoods belongs to each. The display map is simplified; backend membership uses full-precision PostGIS geometry. IDs consistently join back to `neighborhood_profiles`.

The two current feeds are `nws_alerts` and `usgs_gauges`. Each includes `availability`, `source_checked_at`, `source_published_at`, `valid_until`, `record_count`, `payload`, `source_url`, `attribution` and `note` when available. An unavailable feed may have only its ID/status and null payload. Check both snapshot and feature `valid_until` every time data is displayed, including cached data. `stale` or `unavailable` is not zero alerts; `no_current_observations` is not evidence of low water or no flood risk. A fresh empty NWS feed means no active alerts were returned in the queried scope. Alerts without geometry remain regional context even when a neighborhood ID is supplied.

USGS values use each station's datum; they are not comparable flood depths or parcel risk scores. The backend refreshes both providers every 15 minutes. Snapshot expiry is at most 30 minutes; gauge observations expire six hours after observation, alerts at their own expiry. Use the RPC, not raw `live_context` table reads, to enforce server-side expiry. These source cadences do not need Supabase Realtime subscriptions.

Invalid IDs/categories return HTTP 400 with the standard error structure. Follow the same unavailable/retry behavior as profile reads. The refresh endpoint, staging and publishing functions are private ingestion operations; the frontend must not call them.

See the working [Leaflet map demo and integration guide](map-integration.md), [current-feed operations](live-feeds.md), and [facility provenance](neighborhood-context.md).

## Category evidence

`GET /rest/v1/rpc/get_neighborhood_evidence?p_neighborhood_id=62` (or POST with `{"p_neighborhood_id":62}`) returns facts for the screenshot's eight priorities. Omit the ID for all 88 neighborhoods. Use the same publishable-key header; this is a public read with no upstream fetch or scoring invocation.

Response: `{ profile_id, weight_total, evaluated_at, category_definitions, safety, neighborhoods, interpretation }`. Each neighborhood has its canonical ID/name, labeled reference point, and `categories` keyed exactly by `afford`, `commute`, `flood`, `amen`, `fit`, `food`, `air`, `health`. Each category contains `{ availability, facts, sources, missing_inputs, limitations, evidence_version, prepared_at, refresh_due_at, score, score_status }`.

Only `partial` or `reference_snapshot` exposes usable facts. `unavailable` and `needs_refresh` return `facts:null`. Every score is null and `score_status:not_implemented`; safety is unweighted with no tier. Sources identify a URL, check time and observation period (null when unknown). IDs outside 1–88 return HTTP400. Failed reads must not substitute mock scores.

Facts include `afford.median_gross_rent_monthly_usd`, `afford.median_home_value_usd`, `afford.housing_stock`; facility categories use `inventories.<facility_category>.record_count_in_neighborhood` and `nearest_to_reference_point` (up to 3 records). `food.inventories.grocery_stores` covers only the USDA SNAP subset. `commute.destinations` has five office proxies and `air.destinations` two airport proxies, with `straight_line_meters` and **null `drive_time_minutes`**. Flood facts contain coverage/edition metadata and exposure percentages only where validated. See [category evidence](category-evidence.md) for exact meanings.

Cache at most one hour, recheck each `refresh_due_at` before rendering, and clear facts after that deadline. The RPC checks live source/boundary dependencies; use it instead of the raw evidence table. `createEvidenceClient` in `backend/src/evidence.ts` validates single-neighborhood reads, coalesces requests, clones cached values and rechecks expiry. Keep one client per process/app. No subscription or per-visitor ingestion is needed.

## Neighborhood MCP

Local stdio server, `backend/dist/mcp.js`, same publishable key and cached API client. See [backend setup](../backend/README.md).

| Tool | Input | Result |
| --- | --- | --- |
| `list_neighborhoods` | Optional `name` substring, positive `max_median_rent`, positive `max_median_home_value`, `limit` 1–88 (default 10) | `total_matches`, up to `limit` `neighborhoods`, `data_version`, interpretation guidance |
| `get_neighborhood` | Required integer `neighborhood_id`, 1–88 | `neighborhood`, `data_version`, interpretation guidance |
| `get_neighborhood_amenities` | Required `neighborhood_id` 1–88; optional `category`, `limit` 1–100 | Facility counts, bounded records and source provenance |
| `get_current_conditions` | Optional `neighborhood_id` 1–88, `limit` 1–20 | Bounded current observations/alerts, availability, timestamps and interpretation notes |
| `get_neighborhood_evidence` | Required `neighborhood_id` 1–88 | Facts, provenance and missing inputs for all eight priorities; null scores and unavailable safety tier |

Results provide context, not recommendation scores. Failed reads return MCP `isError: true`; none of the tools has write/SQL capabilities. Text and structured responses include source context. Live testing launches the actual stdio process and queries Supabase. Reconnect the MCP after building to discover newly added tools.

## Report integration status

Report endpoints, recruiter authentication, salary/tax calculations, saved-report schema/expiration, ranking, crime/services scores, routing and hosted HTTP MCP deployment remain proposed. Effective FEMA map evidence is available through the category endpoint, subject to coverage flags; gauges/alerts remain separate operational context. Neither establishes parcel-level risk. These data reads are ready for frontend integration independently of the scoring/report service.

The user's latest screenshot confirms the existing frontend weight IDs below. [The current evidence matrix](matrix-readiness.md) uses `backend/data/reference/report-priorities.v1.json`; the earlier 100-point draft is superseded. Raw defaults total 54 and produce the screenshot percentages after normalization/display rounding. The evidence API supports these categories, but weights are not an implemented scoring formula.

## Proposed report API

Status: **proposed by the frontend, not yet agreed or implemented.** The following
report endpoints are design proposals; the live neighborhood reads above remain available.

The frontend (`frontend/report-web`) renders against mocked data that conforms to the
TypeScript types in `frontend/report-web/src/types.ts`. Those types define the current
frontend mock shape; the report API below is proposed for the backend owner to agree,
amend, or reject. They do not replace the implemented Supabase response schemas above.

Open questions for @Akretic-Sean, listed here rather than assumed:

- Base URLs for the proposed report service, local and deployed, and its CORS policy.
  The live reference-data base URL and CORS behavior are already documented above.
- Whether report reads need any auth. The build plan says a report is reachable by
  unguessable ID with no login, which implies none on `GET /reports/:id`.
- Whether the recruiter-side endpoints need auth. Presumably yes.
- Whether scoring runs server-side only. The frontend does no scoring and should not.

### Proposed report conventions

- JSON in, JSON out, `Content-Type: application/json`.
- Errors: HTTP status plus `{ "error": { "code": string, "message": string } }`.
- Every figure intended for a candidate carries a `source` string. This is required, not
  optional — the report page prints it under the number.
- No demographic fields in proposed report payloads, in either direction. This proposed
  report restriction is separate from the published aggregate neighborhood profiles.

The source rule is a proposed report requirement. Current frontend types enforce a
`source` on financial rows and lifestyle cards, but do not yet require one on each
neighborhood score/factor or hero fact; that gap must be resolved during integration.

---

### `GET /reports/:id`

- Status: proposed
- Purpose: fetch a stored report for the candidate-facing page.
- Authentication: none, if IDs are unguessable and reports expire. To confirm.
- Request: no body.
- Success: `200` with a `Report` object — see `types.ts`. Top-level keys:

  ```json
  {
    "id": "…",
    "dataAsOf": "Aug 2026",
    "candidateFirstName": "Daniel",
    "companyName": "Aurelia Robotics",
    "originCity": "San Francisco",
    "officeName": "The Ion / Midtown",
    "mode": "offer",
    "tenure": "rent",
    "weights": { "afford": 8, "commute": 7, "flood": 6, "amen": 5, "fit": 7, "food": 8, "air": 6, "health": 7 },
    "hero": { "headline": "…", "headlineEmphasis": "…", "intro": "…", "facts": [{ "label": "Role", "value": "Senior ML Engineer" }], "careerTitle": "…", "careerText": "…", "howToReadTitle": "…", "howToReadText": "…" },
    "financial": { "summary": "…", "assumptions": "…", "rows": [], "propertyTaxNote": "…" },
    "neighborhoods": [],
    "lifestyle": [],
    "considerations": [],
    "sources": ["City of Houston Open Data", "U.S. Census ACS 5-year"],
    "disclaimer": "…"
  }
  ```

- A `financial.rows[]` entry:

  ```json
  {
    "label": "Estimated take-home pay",
    "origin": "≈ $138,000",
    "houston": "≈ $141,000",
    "originWidth": 98,
    "houstonWidth": 100,
    "delta": "≈ +$3,000 / yr in Houston",
    "direction": "good",
    "note": "Texas has no state income tax; California withholds roughly 9% at this level.",
    "source": "2026 federal and CA brackets, single filer, standard deduction"
  }
  ```

  `origin`/`houston` are pre-formatted display strings — the frontend does no currency or
  rounding logic, so the backend controls precision. `originWidth`/`houstonWidth` are
  0–100 bar widths relative to each other within the row. `direction` is `good` /
  `caution` / `bad` and only picks the delta's colour.

- A `neighborhoods[]` entry: `id`, `name`, `score` (0–100, relative to the other returned
  areas only), `commute`, `commuteMode`, `afford`, `affordLevel` (`good`/`mid`/`low`),
  `rent`, `flood` (`Clear`/`Caution`/`Avoid`), `services`, `momentum`, `why` (prose),
  `safety`, `x`, `y` (CSS percentages for the abstract map), and `factors[]` of
  `{ label, weight (0–100), note }`.

  These report fields are mock/proposed values, not outputs of the live facility or
  current-condition APIs. In particular, `x`/`y` are abstract-map layout percentages,
  not geographic coordinates. Real map layers use WGS84 longitude/latitude and official
  neighborhood IDs. The frontend mock uses string slugs for `Neighborhood.id`; Supabase
  uses integer IDs 1–88. Integration needs an explicit canonical-ID mapping, not a cast
  of those mock slugs to numbers. The proposed flood/services/momentum/safety fields require validated
  methods and sources before production use; gauges alone cannot supply a flood tier.

  `safety` is one of `"lower than"`, `"typical of"`, `"higher than"` — a tier, never a
  number and never a rank. The page renders it into a sentence about the city median per
  1,000 residents. HPD advises against raw comparison between areas, so the API should
  not expose a comparable figure even if one is computed internally.

- Errors: `404` unknown or expired ID.

### `POST /reports`

- Status: proposed
- Purpose: build and store a report. Backed by the scoring engine.
- Authentication: recruiter session. To confirm.
- Request:

  ```json
  {
    "profile": { "role": "…", "city": "…", "salary": "…", "offer": "…", "office": "…", "grocery": "…", "food": "…", "hobbies": "…", "sports": "…", "workout": "…", "airport": "…", "health": "…" },
    "office": "ion",
    "mode": "offer",
    "tenure": "rent",
    "weights": { "afford": 8, "commute": 7, "flood": 6, "amen": 5, "fit": 7, "food": 8, "air": 6, "health": 7 }
  }
  ```

  `office` is one of `ion` / `downtown` / `energy` / `tmc` / `nasa`. `mode` is `offer` or
  `remote`; in remote mode the offer equals the current salary. Weights are 0–10 each and
  are normalised server-side.

- Success: `201` with `{ "id": "…", "url": "…" }`.
- Errors: `400` on a malformed profile, `422` if no neighborhood survives the filters.

### `POST /reports/:id/expert-lead`

- Status: proposed
- Purpose: the candidate's opt-in to be introduced to a relocation expert.
- Authentication: none; the report ID is the capability.
- Request: `{ "email": "…", "consent": true }`
- Success: `202`, empty body.
- Errors: `400` if `consent` is not exactly `true`. **Nothing is sent onward without it** —
  the frontend blocks submission, and the backend must not treat that as sufficient.

### `GET /reports`

- Status: proposed
- Purpose: the dashboard's report list.
- Success: `200` with `{ "kpis": [], "reports": [] }`. A report summary is
  `{ id, name, origin, role, status, date }` where status is `Viewed` / `Shared` /
  `Draft` / `Expert opt-in`.

### Transcript import and extraction

- Status: **proposed, and the largest open question.**

The create-report flow imports a recruiter call from a meeting-notes tool (Granola,
Fireflies, Fathom, Zoom Notes) and extracts a candidate profile, field by field, each with
a `High` / `Medium` / `Low` confidence the recruiter can check before generating.

The frontend currently fakes both steps. Before it can be built for real we need to agree:
who holds the connector OAuth tokens, whether extraction is a backend endpoint or happens
in the MCP layer, and what the confidence value actually measures.

---

### Endpoint template

Copy this section for each new endpoint and replace the placeholders:

- Status: proposed / agreed / implemented
- Purpose:
- Method and path:
- Authentication:
- Request example:
- Success status and response example:
- Error statuses and response examples:
