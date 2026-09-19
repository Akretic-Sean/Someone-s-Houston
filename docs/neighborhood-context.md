# Published neighborhood context

Verified on 2026-09-19 in the existing Free Supabase project, `hknzivrgihnqzvsafkkr`. This extends the [88 economic profiles](neighborhood-layer.md) with full neighborhood boundaries, reference amenities and two current-condition feeds. Source records are context for a relocation conversation, not a complete recommendation score.

## Imported reference inventories

| Category | Retrieved source records | Published inside/intersecting the 88 neighborhoods | Source period |
| --- | ---: | ---: | --- |
| [Parks](https://mycity2.houstontx.gov/gisweb01/rest/services/HoustonMap/Neighborhood/MapServer/14) | 380 | 374 | Not supplied |
| [Libraries](https://mycity2.houstontx.gov/gisweb01/rest/services/HoustonMap/Neighborhood/MapServer/12) | 43 | 43 | Not supplied |
| [Community centers](https://mycity2.houstontx.gov/gisweb01/rest/services/HoustonMap/Neighborhood/MapServer/8) | 60 | 60 | Not supplied |
| [Hospitals](https://mycity2.houstontx.gov/gisweb01/rest/services/HoustonMap/Neighborhood/MapServer/10) | 108 | 64 | Not supplied |
| [Health facilities](https://mycity2.houstontx.gov/gisweb01/rest/services/HoustonMap/Neighborhood/MapServer/11) | 32 | 30 | Not supplied |
| [Multi-service centers](https://mycity2.houstontx.gov/gisweb01/rest/services/HoustonMap/Neighborhood/MapServer/7) | 11 | 11 | Not supplied |
| [Museums](https://mycity2.houstontx.gov/gisweb01/rest/services/HoustonMap/Neighborhood/MapServer/13) | 61 | 16 | Not supplied |
| [TEA schools](https://services2.arcgis.com/5MVN2jsqIrNZD4tP/arcgis/rest/services/Schools_2024_to_2025/FeatureServer/0) | 1,493 in the requested region | 579 | 2024–25 school year |
| **Total** | **2,188** | **1,177** | Mixed; do not label these realtime |

These are source records, not unique physical facilities across all categories. Multiple service datasets overlap. School locations are not attendance zones, admissions availability, current enrollment or quality ratings. Providers do not supply a reliable inventory observation date for the City layers; `source_checked_at` means we successfully read them, not that every facility is operating today. Source notes retain the original limitations. The published set covers City Super Neighborhoods, not the entire Houston metro.

`backend/data/reference/amenity-sources.json` specifies the reviewed layers, fields, geometry and period. `backend/data/neighborhood-amenities.json` is the reproducible prepared snapshot. No credentials are needed to prepare it. `npm run geo:prepare` validates the full bounded ID inventory before/after retrieval and stops on pagination/schema/size errors. It does not silently substitute older releases.

## Spatial publication

Full-precision WGS84 boundaries live in `neighborhood_boundaries`, indexed with PostGIS. The [City source](https://services.arcgis.com/NummVBqZSIJKUeVR/arcgis/rest/services/Super_Neighborhoods_Demographics/FeatureServer/2) has all 88 IDs. Prepared polygon version: `coh-sn-boundaries-5a9f3eb79545b99e`. Its edit timestamp is not a published effective date.

`npm run geo:publish` stages bounded batches with a server-only key and atomically replaces each complete source. Point locations are matched using polygon intersection; parks use their full area so one park can belong to more than one neighborhood. The public table stores compact locations, neighborhood IDs and provenance; raw facility polygons are not sent with every frontend read. Park markers use points on the polygon surface, not entrances. Neighborhood membership is not walking/driving accessibility.

One source park polygon, Beverly Hills Park (`coh_parks:328`), had a ring self-intersection. PostGIS `ST_MakeValid` repaired it with unchanged measured area, 92,353.6273596207 m². The publisher only repairs invalid polygons when the result remains a valid polygon and the area change is no more than 0.0001%, subject to a tiny numerical floor. Collapsed geometries and material changes fail publication. `geometry_repair_count: 1` and the parks source note disclose the repair; the prepared source snapshot preserves the original geometry. All 88 canonical neighborhood polygons passed topology validation without repair.

Every facility source records the boundary version used for membership. When boundaries change, the API hides stale memberships (`needs_rejoin`) until that source is republished. A failed source import leaves its previous published rows intact. Successful staging is consumed; abandoned staging is private and expires after one day. No decade of events or geometries is imported.

## Current data and frontend access

NWS alerts and USGS water-gauge observations are in a separate current layer, refreshed every 15 minutes. The first successful run returned 70 gauges and zero active alerts in the requested scope; counts change. They have individual and snapshot expiry, with unavailable/stale states. See [live-feed documentation](live-feeds.md) for geographic scope and source limitations.

The frontend calls three read-only Supabase RPCs using the publishable key: `get_neighborhood_map`, `get_neighborhood_places` and `get_current_context`. The [API contract](api.md) specifies arguments and freshness. The [map guide](map-integration.md) includes a Leaflet demo with optional facilities/gauges. Street tiles come directly from the basemap provider. Supabase stores/query-serves your data layer, while the frontend renders and interacts with the map.

Claude uses the same public data through `get_neighborhood_amenities` and `get_current_conditions`, alongside the two existing profile tools. Responses are bounded, include provenance, and omit large geometry. No administrative Supabase MCP access is needed to consume these layers.

## Cost and verification

After initial publication, the five application tables and indexes totaled **1,392,640 bytes (1.33 MiB)**. The entire database, including platform schemas, extensions and allocated staging space, measured **21,990,547 bytes (20.97 MiB)**. These are PostgreSQL measurements at import time, not a billing-dashboard forecast. The map RPC returns about **209 kB** before compression; repeated visitor reads/traffic, rather than the 1,177-row inventory, are the main scale consideration. Cache profiles/map for 24 hours, facilities for one hour, and only poll current layers while visible.

The existing Free plan was retained; no paid map account or additional project was created. One refresh job makes about 2,880 invocations per 30 days and stores only the latest successful snapshot per provider. See [current Supabase pricing](https://supabase.com/pricing) and monitor actual project usage before increasing traffic or refresh frequency.

Verification: 53 offline tests passed; live public-key API and four-tool stdio MCP checks passed; actual database role/expiry/atomic-publication checks passed inside rolled-back transactions. Authenticated refresh returned 200; missing-token requests returned 401. Supabase performance advisors returned no findings. The security advisor reported one informational [RLS-without-policy notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) on private staging: deliberately default-deny, with no anonymous/authenticated schema access and writes restricted to the trusted service role.

The map's API/component checks passed with real data, including caching, layer toggles and expiry. Rendered Leaflet/tile browser verification could not finish because the browser automation service failed to load its request-header policy. The demo is available for local browser review; this is not a claim of a completed visual UI test.
