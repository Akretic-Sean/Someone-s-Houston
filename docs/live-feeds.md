# Current Houston context feeds

These small snapshots complement the Super Neighborhood reference layer. They describe present conditions, not a neighborhood's long-term desirability, safety, or flood risk. Annual Census estimates do not become real-time data when downloaded again.

## Enabled source adapters

| Source | Contents and scope | Refresh and expiry |
| --- | --- | --- |
| [NWS active alerts](https://api.weather.gov/alerts/active?zone=TXC201,TXC157,TXC339) | Active alerts intersecting Harris, Fort Bend and Montgomery counties. Preserve alert polygons when supplied; a county-wide response does not establish that every neighborhood is affected. | Scheduled every 15 minutes; successful provider update must be at most 30 minutes old. Snapshot expires within 30 minutes and alerts also expire individually. A fresh empty response means no active alerts reported in this scope. |
| [USGS latest gage heights](https://api.waterdata.usgs.gov/ogcapi/v1/collections/latest-continuous/items?f=json&bbox=-95.9,29.4,-95.0,30.2&parameter_code=00065&limit=500) | Latest measurement per time series inside longitude/latitude bounds `[-95.9,29.4,-95.0,30.2]`, filtered at request time to the previous six hours. Coordinates allow point overlays. | Scheduled every 15 minutes; snapshot expires after 30 minutes. Each observation must still be no more than six hours old when read. Only the latest snapshot is needed; no growing observation archive. |

The initial live checks on September 19, 2026 found zero active NWS alerts with a provider update at 17:13 UTC, and 70 USGS gages in the requested bounding box observed between 16:00 and 17:00 UTC. Counts change. These checks are not promises of continuous availability.

USGS gage height is measured relative to a station's reference. It is **not** flood depth at a home, a comparable number across stations, or proof that nearby streets are flooded. Preserve the provider's `Provisional` or `Approved` status and link to the official station page. [USGS API documentation](https://api.waterdata.usgs.gov/docs/ogcapi/) identifies these observations and public-domain data; [API keys](https://api.waterdata.usgs.gov/docs/ogcapi/keys/) raise rate limits but were not required for these bounded checks.

NWS county-code queries include both county and intersecting forecast-zone alerts; a forecast-zone-only query can miss county-based warnings. [NWS geolocation guide](https://www.weather.gov/media/documentation/docs/NWS_Geolocation.pdf). NWS currently provides this API without fees and requests an identifying User-Agent. The adapter identifies this public repository. [NWS API documentation](https://www.weather.gov/documentation/services-web-api).

## Adapter contract and safeguards

`backend/src/current-feeds.ts` has no third-party or Node-only imports, so the same adapter can run from Node or a Supabase Edge Function.

```ts
const { feeds, errors } = await fetchCurrentFeeds();
// Publish only entries in feeds. Preserve the previous value for each errors entry.
const usable = getFreshFeed(storedFeed); // null means unavailable/stale, never “no alerts”
```

Each feed carries `source_id`, `source_url`, `source_checked_at`, `source_published_at`, `valid_until`, `record_count`, attribution, an interpretation note, and a GeoJSON FeatureCollection. Gauge feature IDs are stable time-series IDs. Dates and minimal selected fields retain source provenance.

Every feature includes `properties.valid_until`: the provider expiry for an alert, or observation time plus six hours for a gauge. Gauge properties include `observed_at` and alerts include `sent_at`, alongside the original source field names. The NWS feed expiry is capped at provider update time plus 30 minutes, even when downloaded later.

- Each provider has a 20-second request timeout and a two-megabyte response cap. NWS is capped at 200 features and USGS at 500; pagination is rejected rather than silently publishing a partial snapshot.
- Non-JSON/error responses, invalid coordinates, unexpected gauge units, impossible/future observation times, and stale provider updates fail the source independently. Failed sources never replace previous data with a successful empty result.
- Missing/unavailable or old gauge values are omitted and counted in the note. An all-unusable gauge response fails instead of asserting that no gages exist.
- A source timestamp is separate from the time it was downloaded. UI and MCP reads must reapply expiry with `getFreshFeed`; the database/API wrapper should enforce equivalent filtering even for direct REST clients.
- The USGS API rejected the documented `datetime=PT6H` shorthand during verification. The adapter uses an absolute ISO timestamp range instead. Version `v1` was verified directly; the tested `v0` URLs redirected to `v1`.

Run focused checks from `backend/`:

```sh
npm run build
node --test test/current-feeds.test.mjs
```

## Sources deliberately not labeled live

| Source | Verified limitation |
| --- | --- |
| [Houston 311 recent requests](https://mycity2.houstontx.gov/pubgis01/rest/services/311/Houston311_RecentServiceRequests/FeatureServer/3) | The service describes 30-minute updates, but its newest creation date remained May 28, 2026 during September 19 checks. The parallel daily/weekly and production services returned the same old newest date. Do not publish this as today's complaints or current neighborhood conditions. |
| [Houston TranStar RSS](https://traffic.houstontranstar.org/rss/rss_info.aspx) | Incident, closure, and travel-time RSS feeds were current to within minutes, but contain road names rather than coordinates. The [content-use terms](https://traffic.houstontranstar.org/disclaimer.aspx) require permission for redistribution except where authorized. Public-feed reading is supported; product republication should be clarified before import. The [structured JSON API](https://traffic.houstontranstar.org/api/api_doc.aspx) directs developers to contact TranStar for live access. |
| [METRO realtime](https://api-portal.ridemetro.org/) | Official developer signup and API subscription key are required. No account or subscription was created in this work. Current bus arrivals may help a selected commute later; they are not a replacement for routing. |

## Keep costs small

One central refresh every 15 minutes is 96 runs per day, about 2,880 per 30 days, independent of the number of visitors. Each successful source replaces its one current row, including its checked/expiry times; there is no growing observation archive. Serve cached reads. Render map tiles in the browser through the chosen map provider; do not put basemap tiles or historical feed archives into Supabase. This remains in the existing Free project; current allowances include 500 MB database size and 5 GB egress. Traffic still needs monitoring, and Free projects can pause after inactivity. [Supabase pricing](https://supabase.com/pricing).

Supabase Realtime subscriptions are unnecessary for these 15-minute source refreshes. A normal REST read on page load and an optional refresh while the map is visible avoid persistent connections and repeated change broadcasts. If a provider fails, show the timestamp and unavailable state after expiry rather than presenting old data as current.

## Secured refresh endpoint

`backend/src/refresh-current-context.ts` provides `createRefreshHandler`. The Supabase entrypoint is `backend/supabase/functions/refresh-neighborhood-context/index.ts`; build the backend first so its two dependency-free modules exist in `backend/dist/` before deployment.

The endpoint accepts only `POST` and validates a high-entropy, 64-character hexadecimal `x-refresh-token` before any network requests. Only the SHA-256 digest belongs in `auth-config.ts` as `REFRESH_TOKEN_SHA256`; the actual token stays in the private scheduler/Vault configuration. Gateway `verify_jwt=false` is deliberate because this handler implements its own authorization. Frontend and MCP read clients never receive this refresh token or invoke this write endpoint.

The handler fetches both fixed public feeds and upserts each successful snapshot independently into `live_context`, using only runtime-provided server credentials. [Supabase's default environment variables](https://supabase.com/docs/guides/functions/secrets#default-secrets) supply `SUPABASE_URL`, the `SUPABASE_SECRET_KEYS` dictionary, and the legacy `SUPABASE_SERVICE_ROLE_KEY` fallback. Modern secret keys use the `apikey` header; a legacy service-role JWT also uses `Authorization: Bearer`. Database writes do not follow redirects.

Responses contain only source IDs, counts, expiry times, and sanitized error summaries: HTTP 200 for full success, 207 for partial success, and 502 when no write was confirmed. Missing/wrong refresh credentials return 401 without contacting any provider or database. Caller-supplied bodies cannot choose URLs, tables, or SQL. Failed provider fetches leave their stored row untouched; an uncertain database response is reported as unconfirmed instead of claiming the write happened.

## Deployed operation and maintenance

The `refresh-neighborhood-context` Edge Function is deployed on project `hknzivrgihnqzvsafkkr`. The active database Cron job `hou-match-current-context` invokes it every 15 minutes. Both the initial signed invocation and the first automatic run at 17:45 UTC on 2026-09-19 returned HTTP 200 and published both feeds; a request without the private token returned 401. The token is generated inside Postgres and kept as Vault secret `hou_match_context_refresh_token`. Only its public SHA-256 verifier is committed. Do not copy the actual token into Git, the browser, or MCP client configuration.

`hou_match_private.request_context_refresh()` is executable only by the database owner and is the scheduler's fixed target. It removes our abandoned import batches older than one day and our own Cron history older than seven days. Supabase's pg_net response retention is managed separately. Normal frontend reads call `get_current_context`; they never initiate provider fetches or writes. See [Supabase scheduling documentation](https://supabase.com/docs/guides/functions/schedule-functions).

Build before redeploying so `backend/dist/current-feeds.js` and `backend/dist/refresh-current-context.js` exist. From `backend/`, after CLI authentication:

```sh
npm run build
npx --yes supabase@2.117.0 functions deploy refresh-neighborhood-context --project-ref hknzivrgihnqzvsafkkr
```

The checked-in function configuration sets `verify_jwt=false`; the handler's token check is mandatory. When installing in another project, update the project URL in the scheduler migration and deploy a verifier derived from that project's Vault token. A database migration alone does not deploy the Edge Function. To rotate authentication, pause only this Cron job, replace its Vault token, deploy the matching SHA-256 verifier, test a signed invocation, then re-enable it. Never log the Vault secret.

For maintenance, the SQL Editor can call `select hou_match_private.request_context_refresh();` and inspect that request ID in `net._http_response` for HTTP 200/207/502. Cron success means the request was queued, not that the upstream feeds refreshed: also inspect `live_context.source_checked_at`/`valid_until` and the HTTP response. To stop automatic refresh, run `select cron.unschedule('hou-match-current-context');`. Source failures retain previous snapshots, but consumers hide them after expiry.

The GitHub `Backend data health` workflow checks actual public feed freshness and reference evidence deadlines every 15 minutes after merging to main and configuring its public API variables. It creates/updates a single issue assigned to **@Akretic-Sean** and resolves it when checks recover. See [data operations](data-operations.md) for activation, failure handling, reference ownership and monitoring limitations.

```sh
npm run build
node --test test/refresh-current-context.test.mjs
```
