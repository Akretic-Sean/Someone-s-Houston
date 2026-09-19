# Shared API contract

Neighborhood profiles, maps, facility context and current-condition reads are **implemented and live**, 2026-09-19. This is the backend's integration contract for frontend review; the complete report/scoring contract still needs agreement.

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

## Neighborhood MCP

Local stdio server, `backend/dist/mcp.js`, same publishable key and cached API client. See [backend setup](../backend/README.md).

| Tool | Input | Result |
| --- | --- | --- |
| `list_neighborhoods` | Optional `name` substring, positive `max_median_rent`, positive `max_median_home_value`, `limit` 1–88 (default 10) | `total_matches`, up to `limit` `neighborhoods`, `data_version`, interpretation guidance |
| `get_neighborhood` | Required integer `neighborhood_id`, 1–88 | `neighborhood`, `data_version`, interpretation guidance |
| `get_neighborhood_amenities` | Required `neighborhood_id` 1–88; optional `category`, `limit` 1–100 | Facility counts, bounded records and source provenance |
| `get_current_conditions` | Optional `neighborhood_id` 1–88, `limit` 1–20 | Bounded current observations/alerts, availability, timestamps and interpretation notes |

Results provide context, not recommendation scores. Failed reads return MCP `isError: true`; none of the tools has write/SQL capabilities. Text and structured responses include source context. Live testing launches the actual stdio process and queries Supabase. Reconnect the MCP after building to discover newly added tools.

## Still proposed

Report endpoints, recruiter authentication, salary/tax calculations, saved-report schema/expiration, ranking, effective floodplain and crime/services scores, routing and hosted HTTP MCP deployment remain proposed. Current gauge/alert context is not a substitute for an effective floodplain or parcel-level assessment. The data layers are ready for frontend integration independently of those decisions.
