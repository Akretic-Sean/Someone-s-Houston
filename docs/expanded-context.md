# Optional neighborhood context: family, transit and reported crime

This additive backend layer leaves the eight weighted categories, scoring/evidence RPCs and `shared/scoring.mjs` unchanged. No frontend files are changed. New facts do not enter the score.

## Connect Claude/the frontend

> Read docs/expanded-context.md and docs/frontend-backend-handoff.md. Add optional selected-neighborhood cards using get_neighborhood_relocation_context. Preserve scoring and login. Show housing detail, dated school locations, METRO scheduled service context and clearly historical 2024 reported offense counts. Render facts only for usable availability and before refresh_due_at; retain source periods/links and limitations. Do not invent safety tiers, crime rates, school eligibility, transit frequency, driving minutes or current listings. Do not sum crime fields into an all-crime total. An optional-context failure must not break the ranked report.

Public read using the existing **publishable key**:

```http
POST https://hknzivrgihnqzvsafkkr.supabase.co/rest/v1/rpc/get_neighborhood_relocation_context
Content-Type: application/json
apikey: <publishable key>

{"p_neighborhood_id":62}
```

The local product MCP has a sixth read-only tool: `get_neighborhood_relocation_context({"neighborhood_id":62})`. Rebuild/reconnect Claude's MCP to discover it. `backend/src/relocation.ts` supplies a validating client with request coalescing and caching up to one hour or the earliest source deadline. Outages never substitute mocks.

Response fields: `schema_version: 1`, `neighborhood_id`, `evaluated_at`, `scoring_effect: "none"`, `housing`, `schools`, `transit`, `reported_crime`, `safety`, `official_links`. Each data block has `availability`, `facts`, `refresh_due_at`. Housing retains the existing `sources` array; other blocks have a `source` object. New source manifests include check time, published period, SHA-256, version, boundary version, attribution, limitations and audit metadata.

| Block | Usable availability | Meaning |
| --- | --- | --- |
| `housing` | `partial` / `reference_snapshot` | Existing affordability evidence: ACS 2020–2024 rent/value and housing-type, bedroom and age marginal tables. Not current listings or combined bedroom/type/age inventory. |
| `schools` | `reference_snapshot` | `count`, `returned_count`, `truncated`, up to 20 named `schools` inside the boundary. Existing TEA 2024–2025 location snapshot. Not attendance eligibility, current enrollment, quality or childcare vacancies. |
| `transit` | `scheduled_snapshot` | `stop_count`, `rail_stop_count`, `active_route_count`, named `routes`, seven `service_dates`, five `nearest_stops`. Ordinary pickup on at least one selected day. Stop/platform counts are not unique stations, departures or frequency. Nearest stops may be outside the neighborhood. Distances are straight-line meters from its reference point. |
| `reported_crime` | `historical_snapshot` | `year:2024`, publisher neighborhood name, and five selected counts: aggravated assault, robbery, burglary, motor vehicle theft, theft from motor vehicle. Not unique incidents, population rates, current conditions, an all-crime total or a safety rating. Null remains unknown. |

`unavailable` / `needs_refresh` always return `facts:null`. Recheck expiry on cached display/tab resume. Failed optional reads should show unavailable/retry without blocking a separately valid report. Safety remains unavailable/unweighted. Maintain the existing brokerage-report omission rule for safety comparisons.

Display METRO's attribution: **Route and arrival data provided by permission of METRO**. Service dates are in `America/Chicago`. Expiry conservatively uses midnight UTC after the final service date, earlier than the local service day ends.

## Sources and preparation

- [METRO developer portal](https://api-portal.ridemetro.org/) / [static GTFS](https://metro.resourcespace.com/pages/download.php?ref=4835&ext=zip). Reviewed feed `August2026IVOMS_20260828`, effective August 30, 2026–January 23, 2027. Initial service window September 19–25. Calendar exceptions override weekday rules; arranged/no-pickup stops are excluded. Frequency-based feeds require explicit importer support. This does not establish real-time arrivals, reliability, walking connectivity or a workplace route.
- [City HPD Crime Summary](https://services.arcgis.com/NummVBqZSIJKUeVR/ArcGIS/rest/services/HPD_Crime_Summary/FeatureServer/0). All 88 `SNBR_ID` rows; only five documented 2024 fields requested. No 2020–2023 import or all-offense total. Publisher boundary vintage/excluded coordinates are unknown; IDs identify neighborhoods but this is not new geocoding. [Newer HPD raw files](https://www.houstontx.gov/police/cs/Monthly_Crime_Data_by_Street_and_Police_Beat.htm) require separate validation and are not included.
- School/housing blocks reuse reviewed sources. No demographic traits infer family suitability.

From `backend/`, using Python 3.12 with `pip install -r scripts/requirements-flood.txt`:

```sh
# Explicit current Houston calendar date; never use the literal placeholder.
python tools/prepare-relocation-context.py --service-start-date YYYY-MM-DD
npm test
# Server-only publisher configuration in ignored .env.
npm run relocation:publish
npm run test:live
node --env-file-if-exists=.env tools/monitor-data.mjs
```

The preparer verifies canonical boundary bytes/IDs, GTFS foreign keys, calendar/pickup semantics, geometry, source bounds and crime counts. It checks 1.4 million schedule rows locally, publishing only 176 summaries and two manifests (~178 kB prepared JSON). The committed file documents reproducibility; it is **not a runtime fallback**. Preparation re-downloads sources rather than extending old retrieval times.

`publish_neighborhood_supplement` accepts service-role callers only and atomically publishes one complete 88-row source. Invalid batches roll back. Public clients cannot write. Existing scoring/evidence/facility data is untouched. Use the RPC rather than raw facts tables so expiry and boundary-version checks apply.

Refresh transit before its seven-day window expires; check for an updated official crime summary at least every 30 days. These are reviewed operator refreshes, not the 15-minute weather/gauge job. Monitoring checks both manifests, all 176 unique rows, boundary versions and expiry. Warnings start two days before transit expiry and seven days before crime-source review. A new check never makes 2024 observations current. School context expires 31 days after its source check and follows the existing reference refresh procedure.

## Verification

Node tests: validation, unknowns, caching, expiry/outages, publisher bounds, monitoring and MCP calls. Python fixtures: calendar exceptions, pickup restrictions, spatial membership, orphan/incomplete data and historical counts. SQL tests: public reads/denied writes, atomic failures, expiry/boundary invalidation and unchanged scoring. Run `python backend/scripts/test_database.py` from the repository root with Docker for SQL checks.
