# Super Neighborhood reference layer

Implemented and verified on 2026-09-19.

```text
City ArcGIS API -> validation against published tables -> Supabase (88 rows)
                                                          |
                                    cached shared reads --+--> frontend
                                                          +--> local Claude MCP
```

## Selected fields and provenance

The [City Planning demographics page](https://www.houstontx.gov/planning/Demographics/) links the Super Neighborhood dashboard. Its web map references [COH Super Neighborhoods Demographics, layer 2](https://services.arcgis.com/NummVBqZSIJKUeVR/arcgis/rest/services/Super_Neighborhoods_Demographics/FeatureServer/2).

| Source | Stored field | Purpose |
| --- | --- | --- |
| `POLYID` | `neighborhood_id` | City neighborhood join key |
| `SNBNAME` | `name` | Official display name |
| `M_HHI` | `median_household_income` | Annual household-income context |
| `M_HV` | `median_home_value` | Estimated housing-value comparison |
| `M_GR` | `median_gross_rent` | Estimated monthly gross-rent comparison |
| API `centroid`, `outSR=4326` | `centroid_lat`, `centroid_lon` | Map markers and straight-line distances |

The API returns fractional economic estimates. Rounded whole-dollar values for **all 88 neighborhoods** match the City's [2024 income/home-value table](https://www.houstontx.gov/planning/Demographics/sn-demographics-2024/7-Median-Household-Income-and-Median-Housing-Value.pdf) and [2024 rent table](https://www.houstontx.gov/planning/Demographics/sn-demographics-2024/8-Median-Gross-Rent-2024.pdf). Both publications identify the **2020–2024 ACS five-year** product, released January 2026. Only the 2024 columns were retained. ID 65 has slash-spacing differences between PDFs and API; the reference uses the API spelling after verifying ID and values.

`backend/data/reference/super-neighborhoods-2024.json` holds the independently extracted reference values, URLs and PDF SHA-256 hashes. `backend/data/super-neighborhoods.json` is the normalized, versioned snapshot. The API has no explicit vintage field in these rows, so the importer requires this verified release's economic values instead of guessing a year from edit timestamps.

Hidden Valley's rent is missing in both API and table; the City attributes missing estimates to insufficient sample observations. The API preserves `null` with a `rent_unavailable` flag. No income/home-value estimates are missing. Race, ethnicity, age, household composition, resident records and unrelated historical periods are not imported. Population is omitted from this affordability layer; a future crime-rate denominator needs separate validation.

These are **City-published neighborhood estimates**. The importer does not average block-group medians or infer the City's spatial estimation method. The selected layer has no neighborhood margins of error; do not treat small differences as precise or values as current property-price quotes. City Super Neighborhoods do not cover every Houston-area suburb.

## Keeping it small and current

- One 88-row table, one primary-key index. Full polygons are omitted from routine responses; add them separately when spatial joins require them.
- One source request per preparation, one bulk write when data changes. Reports and frontend filters need no upstream downloads.
- One application read loads all records, cached for up to 24 hours per running client/process. Reloads/new processes make another first read; the database endpoint itself has no newly deployed CDN cache.
- One active release in the table. Small versioned Git snapshots provide reproducibility. Future saved reports should embed their metrics and source version.
- Check for new releases monthly. No scheduler, keep-alive or frequent refresh job was enabled. Release upgrades need a reviewed reference/period update; failed validation leaves the hosted table untouched.

## Cost and measured footprint

The existing project's organization is on **Free**, verified through Supabase on 2026-09-19. No upgrade or extra project was created. [Published Free limits](https://supabase.com/pricing) include 500 MB database space, 5 GB egress, 1 GB object storage and unlimited API request count within the plan's other resource limits. This layer uses neither object storage nor Edge Functions. Free projects may pause after one week of inactivity; resume in the dashboard before a demo rather than paying for always-on capacity now.

Measured after import:

| Measurement | Result |
| --- | --- |
| Neighborhood rows / active versions | 88 / 1 |
| Table including indexes/TOAST | 73,728 bytes (72 KiB) |
| Entire database at check time, including Supabase schemas | 10,947,731 bytes (about 10.4 MiB) |
| JSON from shared live client, before transport compression | 42,685 bytes (about 42 KiB) |
| One local first-read observation | 326 ms; cached read under 1 ms |

Latency is one observation, not a guarantee. Storage is far below Free limits; total traffic and other features still determine quota use. Watch Dashboard > Usage as traffic grows. Reuse the dataset rather than querying per card. A static copy of the public snapshot is an option if traffic grows substantially. This layer needs no paid add-ons, Realtime subscriptions, embeddings or vector services.

## Verification

- All 264 economic cells, including one missing value, cross-checked against published tables; IDs/names reconciled for all 88.
- TypeScript build and nine offline tests passed.
- Live API returned all rows; missing rent and Midtown values verified.
- Actual stdio MCP process discovered both tools and returned Midtown from Supabase.
- Live anonymous REST insert denied; SQL checks confirmed reads and denied insert/update/delete for anonymous and authenticated roles.
- Supabase security and performance advisors clear after restricting client execution of the pre-existing administrative auto-RLS event trigger. [Advisory explanation](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).

Local Docker/pgTAP testing and live execution of the secret-key REST publisher were not performed. Initial import used the authenticated Supabase SQL connection; the publisher's one-batch/unchanged behavior has offline coverage. Frontend UI integration, Oleg's own MCP connection, and HTTP MCP hosting are separate steps.
