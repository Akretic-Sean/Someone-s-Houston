# Prioritized public data sources for Hou Match

Researched 2026-09-19. Priorities reflect the relocation-report scope and the [bounded data policy](backend-data-policy.md). "Verified" means the specific metadata/sample check described below succeeded, not that a production importer or scoring method is complete. No bulk historical datasets were imported during this research.

Implementation update: the 88 profiles/boundaries, eight facility inventories and NWS/USGS current feeds are now [imported and available](neighborhood-context.md). For the next imports, use the [updated source plan](next-data-sources.md): it includes a newly verified FEMA endpoint, METRO download and current Census/HUD access requirements. The original priorities/readiness notes below are retained as earlier research, not the current deployment inventory.

## Top priorities

| Priority | Specific source | Product use | Access and narrow import scope | Readiness |
| --- | --- | --- | --- | --- |
| 1 | City of Houston **COH Super Neighborhoods Demographics**, ArcGIS FeatureServer layer 2 | Neighborhood geometry, income, home value, optional rent; population for a separately validated rate denominator | Public REST query; 88 features. Select `POLYID`, `SNBNAME`, `M_HHI`, `M_HV`, `M_GR`, and `T1` only as needed. One current dataset version. | Count and three selected-field samples succeeded without a key. Sampled estimates round to the City's published 2024 tables. Validate all rows, missing estimates, identifiers, and the City's estimation method before scoring. |
| 2 | Houston Open Data **ACS five-year block-group income/home value** and **median gross rent**, 2024 resources | Portal-native affordability sources, supporting detail, and cross-checks | Public CKAN DataStore; use only selected 2024 resources and the Houston study area. | Both resources previously returned samples; each reports 3,524 rows. These cover a wider three-county area and require a geographic crosswalk. Use the City-prepared estimates above where suitable rather than inventing neighborhood medians. |
| 3 | **U.S. Census ACS five-year API** | Comparable Houston, San Francisco, and New York city baselines | Select the same product/year and geography definitions; fields `B19013_001E` income, `B25077_001E` home value, `B25064_001E` rent, plus margins of error where needed. | Documentation verified. A direct no-key request redirected to Census's **Missing Key** page; obtain a Census API key before integration. Do not treat the HTTP 200 HTML response as data. |
| 4 | City **HoustonMap / Flood_Hazard** plus authoritative **FEMA effective flood mapping** | Floodplain overlap and floodway context | Public City ArcGIS layers; Harris floodplain layer 1, floodway layer 0; appropriate Fort Bend/Montgomery layers where the study area requires them. Current effective coverage only. | City layer metadata and earlier count query succeeded. Map effective dates/revisions still need reconciliation. Direct FEMA access was unsuccessful in earlier probes. Unknown coverage must remain unknown. |
| 5 | **HPD NIBRS Public View**, recent annual CSVs | Recent reported-crime context | Public CSV downloads. Start by validating 2023–2025 as the proposed three complete years; keep 2026 partial-year data separate. Select dates, categories, offense count, source identifiers, and map coordinates. | 2025 and 2026 CSV headers/small streamed samples succeeded. Both include `Map Longitude` and `Map Latitude`; full coverage, coordinate validity/precision, duplication, and neighborhood joins are unverified. Avoid relying on the older 2020–2024 summary for current scoring. |
| 6 | **IRS**, **California FTB**, **New York Tax Department**, **Harris County Tax Office** reference tables | Take-home comparison and property-tax assumptions | Public tables/downloads; convert only the selected report-year rules into reviewed reference JSON. | Source pages verified; calculations and complete year-specific references have not been validated. These are reference publications rather than one unified API. Property rates need the property's applicable taxing units; missing/unadopted current-year rates must not become zero tax. |

### Endpoints and provenance

**1. City-prepared neighborhood data — recommended first import**

- [Feature layer](https://services.arcgis.com/NummVBqZSIJKUeVR/arcgis/rest/services/Super_Neighborhoods_Demographics/FeatureServer/2)
- [Bounded three-row API sample](https://services.arcgis.com/NummVBqZSIJKUeVR/arcgis/rest/services/Super_Neighborhoods_Demographics/FeatureServer/2/query?where=1%3D1&outFields=SNBNAME%2CT1%2CM_HHI%2CM_HV%2CM_GR&returnGeometry=false&resultRecordCount=3&f=json)
- Provenance: the [City Planning page](https://www.houstontx.gov/planning/Demographics/) links its [Super Neighborhood dashboard](https://www.arcgis.com/apps/dashboards/5e9f53f28acc4cd699e2370506ff3421); that dashboard's public web map references this layer.
- Cross-check against the City's [2024 income/home-value table](https://www.houstontx.gov/planning/Demographics/sn-demographics-2024/7-Median-Household-Income-and-Median-Housing-Value.pdf) and [2024 rent table](https://www.houstontx.gov/planning/Demographics/sn-demographics-2024/8-Median-Gross-Rent-2024.pdf). These also contain 2019 columns: keep the 2024 values only. The rent table marks insufficient estimates with a dash.
- The API does not expose an explicit vintage in the sampled fields. Alignment with 2024 is supported by the sample-to-publication comparison, not by its edit timestamp alone. Preserve this evidence and complete reconciliation before labeling the entire import.
- Keep the City's estimated values clearly labeled; decimal precision is not measurement accuracy. Check `POLYID` against the published neighborhood IDs. Geometry metadata uses EPSG:2278; request/reproject to the coordinate system chosen for our joins. Exclude unrelated demographic attributes from the importer.
- Separate [City boundary layer](https://mycity2.houstontx.gov/gisweb01/rest/services/HoustonMap/Administrative_Boundary/MapServer/3) is available for cross-checking; it also reports 88 features.

**2. Portal CKAN resources**

- [Income and home values](https://data.houstontx.gov/dataset/acs-5-year-median-household-income-and-median-housing-value-estimates-at-block-group-level): 2024 resource `cbefe163-5305-474a-9160-b58cf3b4392a`.
- [Median gross rent](https://data.houstontx.gov/dataset/acs-5-year-median-gross-rent-estimates-at-block-group-level): 2024 resource `29736546-393f-4eff-a294-165227edd16a`.
- Read through `https://data.houstontx.gov/api/3/action/datastore_search` with the selected `resource_id`, fields, filters, and bounded pagination. These are estimates, not active property listings.

**3. Comparison-city API**

- [ACS 2024 five-year API examples](https://api.census.gov/data/2024/acs/acs5/examples.html), [key requirement](https://api.census.gov/data/missing_key.html).
- Base: `https://api.census.gov/data/2024/acs/acs5`.
- City geography codes: Houston `state:48 / place:35000`, San Francisco `state:06 / place:67000`, New York city `state:36 / place:51000`. San Francisco city is not the full Bay Area; label the baseline accordingly. These specific authenticated three-city queries remain to be tested.

**4. Flood layers**

- [City layer directory](https://mycity2.houstontx.gov/gisweb01/rest/services/HoustonMap/Flood_Hazard/MapServer).
- [FEMA guidance on current effective mapping and revisions](https://emilms.fema.gov/is_0273/groups/268.html). A mapped neighborhood overlap is not a parcel-level flood guarantee; the current effective map may legitimately be older than the event-data windows.

**5. Newer HPD data**

- [Official download index](https://www.houstontx.gov/police/cs/Monthly_Crime_Data_by_Street_and_Police_Beat.htm) labels data current as of July 30, 2026.
- [2025 CSV](https://www.houstontx.gov/police/cs/xls/NIBRSPublicView2025.csv), [2026 CSV](https://www.houstontx.gov/police/cs/xls/NIBRSPublicView2026.csv). Only the first 64 KiB of each was sampled, with no event records retained in this repository.
- File headers include occurrence date, NIBRS classification/description, offense count, beat, block/street information, and map coordinates. Validate actual coordinate coverage, time coverage, and offense-count semantics before aggregation. Per-capita figures require a compatible population denominator; police beats and Super Neighborhoods are different units. HPD discourages raw beat comparisons. Follow the existing brokerage-report omission rule.

**6. Financial reference sources**

- [IRS rates and links to report-year adjustments](https://www.irs.gov/filing/federal-income-tax-rates-and-brackets), [California FTB schedules](https://www.ftb.ca.gov/file/personal/tax-calculator-tables-rates.asp), [New York tables](https://www.tax.ny.gov/pit/file/tax-tables/), [Harris County adopted rates](https://www.hctax.net/Property/TaxRates).
- Publication year, tax year, and withholding year are not interchangeable. The reviewed FTB landing page lists 2025 tables, while IRS links 2026 adjustments; complete and test a consistent set before publishing a 2026 comparison. Payroll taxes/deductions also need their official references. Retain explicit assumptions, never imply an individualized tax bill.

## Optional stretch sources, in suggested order

| Source | Useful feature | Access, scope, and limitation |
| --- | --- | --- |
| **TEA AskTED / school GIS / TAPR** | Nearby schools, grade levels, programs, and latest school-year context | [AskTED CSV export](https://tealprod.tea.state.tx.us/Tea.AskTed.Web/help/Download_School_and_District_Data_File.htm), [GIS downloads](https://tea.texas.gov/families-and-students/school-district-locator/about-sdl-geographic-data). Import latest relevant campuses. Export documentation verified, not a completed ingestion. [TEA distinguishes school districts from attendance zones](https://tea.texas.gov/families-and-students/school-district-locator/school-district-locator-faq); nearby schools do not establish enrollment eligibility. |
| **City parks, libraries, and community facilities GIS** | Family-selected access to parks, libraries, healthcare, and community facilities | [Neighborhood MapServer](https://mycity2.houstontx.gov/gisweb01/rest/services/HoustonMap/Neighborhood/MapServer): parks 14, libraries 12, hospitals 10, community centers 8. Public API. Parks metadata verified and earlier count returned 380; other layers need record/date validation. Current locations only. |
| **HUD Fair Market Rents / Small Area FMR** | Bedroom-specific rental benchmarks for families | [HUD API](https://www.huduser.gov/portal/dataset/fmr-api.html): `https://www.huduser.gov/hudapi/public/fmr`; registration and bearer token required. Applicable fiscal-year release only; small-area ZIP coverage must be checked for Houston. These are program rent benchmarks, not listings or guaranteed asking rents. |
| **Zillow Research ZHVI / ZORI** | More recent home-value and observed-rent context | [Public research downloads](https://www.zillow.com/research/data/). Commercial-provider CSVs, not a verified unrestricted listings API. Start with latest available period and at most 12 months if a trend is useful. Check geography coverage and reuse terms; import not tested. |
| **Harris Central Appraisal District public property/GIS files** | Parcel-level property characteristics and taxing-unit joins | [HCAD Public Data](https://hcad.org/hcad-online-services/pdata/). Current-year public downloads; large files require scoped processing. County coverage is not all of Houston. Avoid owner/contact fields. Appraisal values are not active asking prices. Metadata/download route identified, no bulk files pulled. |
| **METRO static GTFS and realtime APIs** | Transit stops/routes, service availability, optional arrival predictions | [Official developer portal](https://api-portal.ridemetro.org/). Latest static schedule download linked there; realtime APIs require signup/subscription key. New alerts endpoint is `/v2alerts/alerts`; older `/GtfsAlerts/Alerts` is retired. A stop nearby is not a complete workplace commute calculation. |
| **NOAA climate normals + NWS alerts** | Expected seasonal heat/rain and a separate current-conditions panel | [NOAA normals](https://www.ncei.noaa.gov/products/land-based-station/us-climate-normals): import only published monthly summaries for selected stations. Their multi-decade statistical basis is useful for climate context; no raw decades need importing. [NWS API](https://www.weather.gov/documentation/services-web-api): current alerts/forecasts, User-Agent required; earlier Houston requests succeeded. Current weather should not drive permanent neighborhood ranking. |
| **AirNow observations/forecasts** | Current regional air-quality context | [API](https://docs.airnowapi.org/webservices) and [cache/use guidance](https://docs.airnowapi.org/faq). Key required for web services; hourly observations and daily forecasts. No authenticated query tested. Reporting areas can cover many ZIP codes, so do not represent this as precise neighborhood exposure. Use the provider's file products for bulk ingestion instead of looping through ZIP codes. |
| **Texas HHS Child Care Search** | Nearby licensed childcare and a useful external lookup | [Public search](https://childcare.hhs.texas.gov/Public/ChildCareSearchResults). Search by location/children's ages exists; a supported bulk/API connector was not verified. Start with a link-out. Licensing does not establish available places or current tuition. |

## Hold back until resolved

- **311 scoring:** the previously tested recent-requests layer stops at May 2026 and does not offer complete historical closures. Find a complete current source before importing a 12-month scoring window.
- **Permit momentum:** the tested portal table is citywide. [City Planning](https://www.houstontx.gov/planning/Demographics/) also links 2025 single-family/multifamily/demolition spreadsheets, but their fields and neighborhood suitability were not tested. Keep this conditional.
- **Old HPD neighborhood summary:** useful metadata reference, but the version ending in 2024 fails our proposed freshness rule. Prefer validating newer CSVs.
- **Hackathon track eligibility:** City-hosted data is not automatically a separately listed portal dataset. Verify the required number of qualifying portal datasets with the track rules. Do not count duplicate delivery formats or fields as independent datasets.

Recommended sequence: validate the 88-row City neighborhood API, obtain comparable Census baselines, verify flood coverage, and establish dated tax references. Validate newer HPD data before enabling the crime metric. Add schools/parks or updated rental benchmarks if time remains. Everything feeds prepared Supabase metrics; no source fetch is required during ordinary report generation.
