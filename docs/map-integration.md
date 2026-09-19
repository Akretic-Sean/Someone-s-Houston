# Frontend neighborhood map

Use **Leaflet in the frontend**, Supabase for neighborhood polygons/data, and a separate basemap tile provider for streets. Supabase does not need to serve map tiles or run a map server. The browser joins layers by `neighborhood_id` (City `POLYID`, 1–88). The demo lives in `backend/map-demo.html`; nothing in `frontend/` is changed.

## Data and API contract

`POST https://hknzivrgihnqzvsafkkr.supabase.co/rest/v1/rpc/get_neighborhood_map`, JSON body `{}`, headers `apikey: <SUPABASE_PUBLISHABLE_KEY>` and `Content-Type: application/json`.

The result is a WGS84 GeoJSON `FeatureCollection`. Each feature has numeric `id`, `properties.neighborhood_id`, `properties.name`, `properties.boundary_version`, `properties.source_checked_at`, and Polygon/MultiPolygon `geometry`. Coordinate pairs are **longitude, latitude**. The map endpoint returns simplified display geometry; database spatial joins use the original geometry. A service's check/edit time is not the effective date of a boundary or an ACS observation period.

```js
const headers = { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' };
// Do this once on map load and retain the results in shared application/query state.
const [mapResponse, profileResponse] = await Promise.all([
  fetch(`${SUPABASE_URL}/rest/v1/rpc/get_neighborhood_map`, {
    method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(20000)
  }),
  fetch(`${SUPABASE_URL}/rest/v1/neighborhood_profiles?select=*&order=neighborhood_id.asc&limit=88`, {
    headers, signal: AbortSignal.timeout(15000)
  })
]);
if (!mapResponse.ok || !profileResponse.ok) throw new Error('Neighborhood map unavailable');
const [boundaries, profiles] = await Promise.all([mapResponse.json(), profileResponse.json()]);
const byId = new Map(profiles.map(row => [row.neighborhood_id, row]));
const layer = L.geoJSON(boundaries, {
  onEachFeature(feature, polygon) {
    const profile = byId.get(feature.properties.neighborhood_id);
    const popup = document.createElement('div');
    // textContent avoids interpreting source strings as HTML.
    popup.textContent = `${feature.properties.name}: ${profile?.median_gross_rent ?? 'Unavailable'} estimated monthly gross rent`;
    polygon.bindPopup(popup);
  }
}).addTo(map);
map.fitBounds(layer.getBounds());
```

Keep geometry and profiles cached for 24 hours per app/client; discard after expiry or a known dataset version change. Filters, highlights, clicks and viewport changes work locally. Do not refetch all 88 polygons on every map move and do not subscribe to Supabase Realtime for reference boundaries. Source refresh is a separate, infrequent backend operation. Supabase Realtime transports database changes; it cannot make an annual City release current-minute data.

## Try the integration demo

From the repository root:

```sh
python -m http.server 8765 --bind 127.0.0.1 --directory backend
```

Open `http://localhost:8765/map-demo.html`. Paste the project's **publishable** key and select **Load neighborhood map**. The demo keeps the key and API responses only in page memory, accepts no admin/secret key, and makes two base-layer Supabase requests per cache period. Click a polygon or use the accessible neighborhood selector. The panel and popup show rent and ACS source period. Disable street tiles to view the boundary layer alone. Optional facility/gauge controls add the requests described below. Keep this on localhost for testing; the frontend team can adopt the same fetch/render logic.

Leaflet 1.9.4 is the current stable release in its [official download documentation](https://leafletjs.com/download.html). The demo pins its CDN files and integrity hashes. For the real frontend, install the pinned version in that project's own package/lockfile and bundle it. See [Leaflet GeoJSON documentation](https://leafletjs.com/examples/geojson/) for style and interaction options.

## Optional context overlays

Both controls start **off**, so opening the base map does not load additional data.

| Layer | Supabase RPC POST body | Read/cache behavior | Interpretation |
| --- | --- | --- | --- |
| Facilities in the selected neighborhood | `get_neighborhood_places`, `{ "p_neighborhood_id": 62, "p_category": null }` | On selection while enabled, cached per project/neighborhood for one hour; no requests on pan/zoom; concurrent requests for the same ID coalesce | Reference locations, not quality, operating hours or current service availability |
| Regional water gauges | `get_current_context`, `{}` | At most one request every five minutes while enabled and the page is visible; reuse an in-flight request; stop when disabled/hidden | Latest usable USGS station heights, not flood depth or a neighborhood risk score |

Facility responses contain a GeoJSON `FeatureCollection` plus `sources`. The demo joins `feature.properties.source_id` to that metadata and only displays sources whose `availability` is `reference_snapshot`. `needs_rejoin` and other unavailable sources stay hidden. Popups show name, category, address where available, source period and source note. Schools currently use 2024–25; other inventories may have unknown observation periods. Polygon parks use representative points for display, which are not entrances. Some facilities appear in multiple source categories, so marker counts are not counts of unique amenities.

For gauges, select the feed with `source_id: "usgs_gauges"` from the returned `feeds` array. Require `availability: "current"`, a future `valid_until`, and a non-null GeoJSON payload. Check each point's `properties.valid_until` and `observed_at` as well. The demo filters expired points and schedules a local expiry timer: old markers disappear even between polls. An expired/missing feed or refresh failure shows an unavailable state rather than zero water levels. Disabling the layer or hiding the page clears its markers and timers; returning to the page rechecks freshness before displaying anything.

Gauge popups show `monitoring_location_id`, `value`, `unit_of_measure`, `observed_at`, and `approval_status` (Provisional/Approved). Values use each station's local reference; **do not compare raw heights across stations or use them to color neighborhoods by flood risk**. The map retains USGS attribution in each popup. All source strings use DOM `textContent`, not HTML interpolation. This demo does not display NWS alert polygons; the same current-context response is available for a future alert UI.

Measured live base payloads: **208,530 bytes** for the map RPC and **13,709 bytes** for the demo's selected profile fields, before transfer compression. Full-quality source geometry is retained separately for backend spatial joins.

## Basemap and cost

The demo requests `https://tile.openstreetmap.org/{z}/{x}/{y}.png` directly from the browser. It displays OpenStreetMap attribution and allows the basemap to be disabled or replaced. This is appropriate for ordinary, low-volume interactive use under the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/): retain browser caching and referrers, no offline/bulk downloads or viewport prefetch jobs. The service has no availability guarantee; choose a tile provider with a suitable plan before material public traffic. A provider switch does not change Supabase or the polygon API. The demo does not create a paid map account.

Supabase serves only our small geometry and data payloads; panning/zooming uses locally loaded polygons and the independent tile service. This avoids putting tile bandwidth through Supabase. For a larger audience, publish a versioned, compressed static copy of the **display** GeoJSON with the frontend/CDN and cache it across visitors. Keep canonical geometry in PostGIS for point-in-neighborhood calculations. There is no need for a vector tile server for 88 areas.

## Source, refresh and validation

Full-precision snapshot: `backend/data/super-neighborhood-boundaries.geojson`. Provenance/check time/hash: `backend/data/super-neighborhood-boundaries.manifest.json`. The preparation command fetches only IDs, names and geometry from [City of Houston's Super Neighborhood layer 2](https://services.arcgis.com/NummVBqZSIJKUeVR/arcgis/rest/services/Super_Neighborhoods_Demographics/FeatureServer/2), requests `outSR=4326`, caps the download at 10 MB/45 seconds, and fails on truncated responses, duplicate/missing IDs, renamed neighborhoods, invalid coordinate bounds, open rings or zero-area rings. It retains all source vertices and normalizes ring direction, without simplifying the snapshot. Publication additionally validates topology with PostGIS `ST_IsValid`; structurally valid GeoJSON alone is insufficient for spatial joins.

```sh
cd backend
npm ci
npm run build
node dist/prepare-boundaries.js
node --test test/boundaries.test.mjs
```

The command replaces the snapshot only when its content changes and updates the provenance sidecar after a successful fetch. The SHA-256 in the sidecar covers the complete GeoJSON file including its final newline. Verify that hash before publishing if files were transferred separately. This prepares data; use the documented backend publication command to write to Supabase. The static boundary version reflects content, not retrieval time. Check after a City boundary release, or at a low-frequency maintenance interval; a minute-by-minute refresh adds cost without improving these boundaries.

Initial snapshot: 88 polygons, 33,386 coordinate pairs, 1,245,018 bytes. ArcGIS's data-edit timestamp is 2026-04-10 and its schema-edit timestamp is 2026-05-14; neither is a published boundary effective date. All 88 IDs/names match the existing economic profile snapshot. The 2020–2024 ACS label applies to the economic profiles, not to the boundary geometry.
