# Report category evidence

The current contract follows the user's screenshot: affordability, commute, flood context, amenities, fitness, dining/groceries, airports and healthcare. See [coverage and remaining gaps](matrix-readiness.md). This layer supplies facts for future report generation; it does not implement ranking, taxes, private candidate storage or safety tiers.

## Read from the frontend or Claude

```js
const response = await fetch(
  `${SUPABASE_URL}/rest/v1/rpc/get_neighborhood_evidence?p_neighborhood_id=62`,
  { headers: { apikey: SUPABASE_PUBLISHABLE_KEY }, signal: AbortSignal.timeout(15000) }
);
if (!response.ok) throw new Error('Evidence unavailable');
const data = await response.json();
const affordability = data.neighborhoods[0].categories.afford;
// Check availability and refresh_due_at before displaying facts.
```

In Claude Code's local product MCP, use `get_neighborhood_evidence({"neighborhood_id":62})`. Rebuild/reconnect to discover this fifth tool. The same facts and source restrictions apply to both paths. [API details](api.md#category-evidence) and [Claude setup](claude-data-guide.md) explain the rest.

Use the existing small profile list to choose a shortlist, then fetch evidence for those neighborhoods. One neighborhood is roughly 45kB before compression; all 88 are about 4MB. The all-neighborhood call is available for batch analysis, but avoid downloading it on every page or slider movement. Cache evidence for up to an hour and recheck each row's deadline. No upstream provider requests occur during these reads.

## Sources and what they mean

- **Housing:** City [structure](https://www.houstontx.gov/planning/Demographics/sn-demographics-2024/11-Units-in-Structure-2024.pdf), [bedrooms](https://www.houstontx.gov/planning/Demographics/sn-demographics-2024/12-Bedrooms-2024.pdf) and [year built](https://www.houstontx.gov/planning/Demographics/sn-demographics-2024/13-Year-Structure-Built-2024.pdf), ACS 2020–2024, released January 2026. All88 IDs match; rounded category sums differ from published totals by at most two units and retain flags. These are separate marginal distributions, not combined listing inventory. Construction date remains relevant as a current housing-stock attribute.
- **Groceries:** [USDA SNAP retailer layer](https://services1.arcgis.com/RLQu0rK7h4kbsBq5/arcgis/rest/services/snap_retailer_location_data/FeatureServer/0), inventory edited 2026-09-17. Downloaded 923 regional grocery/supermarket/superstore records; 380 intersect the canonical neighborhoods. This is a SNAP-authorized subset, not all grocery stores and not dining. Zero means zero matching records in this inventory, never no food access.
- **Flood:** [effective FEMA NFHL](https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28), 13,314 complete hazard polygons plus 176 panels, 143 revision polygons and 6 availability polygons. Source geometry stays outside Supabase. Full-precision equal-area unions prevent double-counting. Thirty-one controlled geometry repairs had maximum area delta 0.000002m². The compact 88-row snapshot retains completeness fingerprints and repair audit.
- **Flood gaps:** exposure percentages are null for IDs 17,25,41,43,80 (Eldridge/West Oaks, Alief, Fort Bend Houston, Kingwood, South Belt/Ellington). Their flags report incomplete/contradictory coverage. Other 83 have usable mapped-area summaries. The 0.2% value is the explicit zone-X band excluding SFHA; floodways are a subset of SFHA and must not be added. Area includes water/nonresidential land; it is not a home's flood probability. Older still-effective panels remain relevant. Superseded LOMRs do not determine the current revision date.
- **Amenities, fitness, healthcare:** existing City/TEA facility inventories. This layer uses parks, libraries, museums, community centers, hospitals, health facilities and multi-service centers. Counts can overlap; facility quality, insurance, appointments, opening hours, walking access and entrances remain unverified.
- **Destinations:** [reviewed anchors](../backend/data/reference/destination-anchors.json) cite operator addresses and City geocoding. Five office IDs match the frontend. IAH uses an official navigation-address proxy; HOU uses operator-published navigation GPS. Straight-line distances from a neighborhood reference point are rounded to 10m; they are not road distances, driving minutes, reliability, or a candidate's actual workplace.

Houston's public food-inspection downloads date to 2015, despite newer portal upload metadata. They were deliberately excluded. A current dining source remains missing.

## Storage, refresh and cost control

Refresh owner: **@Akretic-Sean**. See [data operations](data-operations.md) for the October 20 first expiry, October 6 refresh target, source-review sequence and automated 14-day expiry warnings. Missing offline PDF retrieval receipts now stop preparation; boundary geometry must match its manifest before evidence spatial joins.

Two added public tables: eight rows in `report_category_config`, and 704 rows in `neighborhood_category_evidence` (88×8). The evidence table and indexes measured 2.6 MiB after publication. Keep one current release; publish all 704 atomically. Candidate details never belong in these public-read tables. RLS/grants deny public writes, and publication uses the existing private bounded staging area with a service-only finalizer.

Evidence is precomputed once per source update. It includes dependency versions, observation/effective dates and explicit unknowns. The RPC hides facts if the boundary, profile/center or referenced facility version changes. It also hides expired facts. `refresh_due_at` is a 31-day review deadline after the oldest successful input check, not a claim that an observation was measured recently. Housing offline regeneration retains the real PDF retrieval date; the economic source is rechecked even if its content is unchanged.

No paid service, plan upgrade, per-visitor routing charge, vector index, raw flood archive or tile storage was added. Use direct frontend basemap tiles and retain the existing 15-minute current-feed job separately. The new reference import is a reviewed manual refresh, not a new scheduled job. Review before a demo and monthly; do not extend timestamps without checking sources.

## Reproduce and publish

From `backend/`, with the ignored `.env` containing URL/publishable key:

```sh
# Python dependencies: use a virtual environment.
python -m pip install pdfplumber==0.11.9 -r scripts/requirements-flood.txt
python tools/prepare_housing.py --self-test
python tools/prepare_housing.py --cache-dir ../../../work/housing-pdfs
python scripts/prepare_flood.py --cache-dir ../../../work/fema-cache
npm run groceries:prepare
# Review destination anchors and refresh existing facilities when due.
npm run evidence:prepare
npm test
npm run test:live

# Backend owner only; requires a server-only modern secret key in ignored .env.
npm run evidence:publish
```

The FEMA cache is hundreds of MB locally; only its ~91kB summary is retained in the repository/database evidence. Housing PDFs are small and checked against reviewed SHA256 hashes. A changed edition/schema, partial inventory or failed validation stops preparation and preserves the last good output. Generated `neighborhood-evidence.json` is ignored because it duplicates derived live data. Housing, groceries, anchors and the compact flood snapshot are committed for review; no credentials are committed.

Production publication used the authenticated Supabase connection, bounded staging batches and the same atomic finalizer. No secret key was downloaded. Validation: 63 backend tests, four housing tests, 12 flood tests, live public API/five-tool MCP reads, anonymous-write denial, missing rent, five withheld flood summaries and rollback SQL tests in `backend/supabase/tests/evidence_access.sql`. An independent Shapely membership check matched all 88 grocery counts. Performance advisors returned no findings. The existing informational [RLS-without-policy notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) remains on private staging, which deliberately denies public access and permits only trusted service writes.

FEMA refreshes download fresh content by default. Explicit `--resume` accepts only timestamped cache batches less than one hour old and retains the oldest actual retrieval time; legacy undated caches are re-fetched. Preparation time never substitutes for a source check.
