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
