# Shared API contract

Neighborhood reference reads are **implemented and live**, 2026-09-19. This is the backend's integration contract for frontend review; the complete report/scoring contract still needs agreement.

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

## Neighborhood MCP

Local stdio server, `backend/dist/mcp.js`, same publishable key and cached API client. See [backend setup](../backend/README.md).

| Tool | Input | Result |
| --- | --- | --- |
| `list_neighborhoods` | Optional `name` substring, positive `max_median_rent`, positive `max_median_home_value`, `limit` 1–88 (default 10) | `total_matches`, up to `limit` `neighborhoods`, `data_version`, interpretation guidance |
| `get_neighborhood` | Required integer `neighborhood_id`, 1–88 | `neighborhood`, `data_version`, interpretation guidance |

Results are ID-ordered, not scored. Failed reads return MCP `isError: true`; neither tool has write/SQL capabilities. Text and structured responses include source periods in returned records. Live testing launched the actual stdio process and queried Supabase.

## Still proposed

Report endpoints, recruiter authentication, salary/tax calculations, saved-report schema/expiration, ranking, flood/crime/services layers and hosted HTTP MCP deployment are not implemented by this change. The reference layer is ready for frontend integration independently of those decisions.

The rest of this file is the **frontend's proposal** for that report contract, added alongside the live neighborhood layer above. It is a starting point for agreement, not a decision. — @Oleggo1

### Where the live layer already fits

`frontend/report-web` currently renders mocked neighborhoods. Three of its fields map directly onto `neighborhood_profiles` and should be swapped first:

| Frontend field | Source |
| --- | --- |
| `Neighborhood.rent` | `median_gross_rent` (monthly, whole USD) |
| `Neighborhood.name` | `name`, joined on `neighborhood_id`, never on a matched name |
| map pin position | `centroid_lat` / `centroid_lon`, projected — the current `x`/`y` percentages are placeholders |

Two figures from the build plan that the report does not yet show have a home in this layer:

- **Standing ratio** — candidate salary ÷ `median_household_income`. The build plan calls this the "live like a king" number.
- **House multiple** — `median_home_value` ÷ annual take-home.

Both need the tax calculation, which is not built. Noting them here so the shape is agreed before they are added.

Display rule carried into the types: values render with **City of Houston estimates • ACS 2020–2024** beneath them, `null` renders as "Unavailable" with dependent calculations omitted, and nothing is ever backfilled with zero. This is why `source` is a required field on every frontend type that carries a figure, rather than optional.

### Conventions for the proposed endpoints

- JSON in, JSON out, `Content-Type: application/json`.
- Errors: HTTP status plus `{ "error": { "code": string, "message": string } }`.
- No demographic fields in any payload, in either direction.

### `GET /reports/:id`

- Status: proposed
- Purpose: fetch a stored report for the candidate-facing page.
- Authentication: none, if IDs are unguessable and reports expire. To confirm.
- Success: `200` with a `Report` object. The normative shape is
  `frontend/report-web/src/types.ts`; top-level keys are `id`, `dataAsOf`,
  `candidateFirstName`, `companyName`, `originCity`, `officeName`, `mode`, `tenure`,
  `weights`, `hero`, `financial`, `neighborhoods`, `lifestyle`, `considerations`,
  `sources`, `disclaimer`.
- Errors: `404` unknown or expired ID.

A `financial.rows[]` entry:

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

`origin`/`houston` are pre-formatted display strings — the frontend does no currency or rounding logic, so the backend controls precision. `originWidth`/`houstonWidth` are 0–100 bar widths relative to each other within the row. `direction` is `good` / `caution` / `bad` and only picks the delta's colour.

A `neighborhoods[]` entry carries `id` (the City's `POLYID`), `name`, `score` (0–100, relative to the other returned areas only), `commute`, `commuteMode`, `afford`, `affordLevel`, `rent`, `flood` (`Clear`/`Caution`/`Avoid`), `services`, `momentum`, `why` (prose), `safety`, map coordinates, and `factors[]` of `{ label, weight (0–100), note }`.

`safety` is one of `"lower than"`, `"typical of"`, `"higher than"` — a tier, never a number and never a rank. HPD advises against raw comparison between areas, so the API should not expose a comparable figure even if one is computed internally.

### `POST /reports`

- Status: proposed
- Purpose: build and store a report. Backed by the scoring engine.
- Authentication: recruiter session. To confirm.
- Request: `{ profile, office, mode, tenure, weights }` where `office` is one of
  `ion` / `downtown` / `energy` / `tmc` / `nasa`, `mode` is `offer` or `remote` (in
  remote mode the offer equals the current salary), and `weights` is the eight
  dimensions at 0–10 each, normalised server-side.
- Success: `201` with `{ "id": "…", "url": "…" }`.
- Errors: `400` malformed profile, `422` if no neighborhood survives the filters.

### `POST /reports/:id/expert-lead`

- Status: proposed
- Purpose: the candidate's opt-in to be introduced to a relocation expert.
- Request: `{ "email": "…", "consent": true }`
- Success: `202`, empty body.
- Errors: `400` if `consent` is not exactly `true`. **Nothing is sent onward without it** — the frontend blocks submission, and the backend must not treat that as sufficient.
- Per the note above, this needs a separately protected table, not the public-read policy.

### `GET /reports`

- Status: proposed
- Purpose: the recruiter dashboard list.
- Success: `200` with `{ "kpis": [], "reports": [] }`. A summary is
  `{ id, name, origin, role, status, date }`, status one of `Viewed` / `Shared` /
  `Draft` / `Expert opt-in`.

### Transcript import and extraction

- Status: **proposed, and the largest open question.**

The create-report flow imports a recruiter call from a meeting-notes tool (Granola, Fireflies, Fathom, Zoom Notes) and extracts a candidate profile field by field, each with a `High` / `Medium` / `Low` confidence the recruiter checks before generating. The frontend fakes both steps today.

To agree: who holds the connector OAuth tokens, whether extraction is a backend endpoint or lives in the MCP layer, and what the confidence value actually measures.
