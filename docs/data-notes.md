# Phase 0: data checks against the build plan

Checked on 2026-09-19 against [the build plan](build-plan.md). These are source-discovery results, not completed import pipelines. Public sample/count queries succeeded where stated; full record validation and joins remain outstanding. The committed `backend/data/houston-catalog.json` contains metadata, not the scoring snapshots required by Phase 0.

## Source findings

| Source | Geography, period, access, and checked fields | Fit for the proposed score |
| --- | --- | --- |
| [City median income and housing value](https://data.houstontx.gov/dataset/city-of-houston-median-household-income-and-median-housing-value) | CKAN DataStore resource `87dbbeba-91e3-4c81-a2a0-0e68a85770d5`; 15 rows. Annual **Houston city** observations, including 2024. Fields `YEAR`, `GEO_ID`, `NAME`, `B19013_001E`, `B25077_001E`. | Useful city baseline. It has no neighborhood-level medians and cannot supply 88 neighborhood scores directly. |
| [ACS five-year block-group median income and housing value](https://data.houstontx.gov/dataset/acs-5-year-median-household-income-and-median-housing-value-estimates-at-block-group-level) | 2024 resource `cbefe163-5305-474a-9160-b58cf3b4392a`; 3,524 rows. Harris, Fort Bend, and Montgomery block groups. Fields `GEO_ID`, `NAME`, `B19013_001E`, `B25077_001E`; sampled values are strings. | More suitable geographic detail, but requires matching block-group boundaries and a documented crosswalk to Super Neighborhoods. Do not average these medians and label the result an exact neighborhood median. |
| [ACS five-year block-group median gross rent](https://data.houstontx.gov/dataset/acs-5-year-median-gross-rent-estimates-at-block-group-level) | 2024 resource `29736546-393f-4eff-a294-165227edd16a`; 3,524 rows. Fields `GEO_ID`, `NAME`, `B25064_001E`. | Optional rent mode has the same crosswalk/aggregation issue. These are period estimates, not current listings. |
| [Super Neighborhood boundaries](https://mycity2.houstontx.gov/gisweb01/rest/services/HoustonMap/Administrative_Boundary/MapServer/3) | Public ArcGIS layer; count query returned 88 features. | Candidate common geography. Validate identifiers and geometry against the HPD layer and ACS crosswalk before joining. |
| [HPD crime summary](https://services.arcgis.com/NummVBqZSIJKUeVR/arcgis/rest/services/HPD_Crime_Summary/FeatureServer/0) | Public ArcGIS layer `HPD_CRIME_SUMMARY_SNBR_2020_2024`; count query returned 88 features. Metadata contains 456 fields including `SNBR_ID`, `SNBR`, `SNBR_ID_1`. No obvious population field found in the metadata scan. | Promising existing neighborhood summary. Still select/validate persons and property fields, obtain matching population/year denominators, and check geography. The exact summary's listing on the Houston portal has not been verified. |
| [311 recent requests](https://mycity2.houstontx.gov/pubgis01/rest/services/311/Houston311_RecentServiceRequests/FeatureServer/3) | Public ArcGIS query. Fields include `CreatedDate`, `ClosedDate`, `Status`, `CaseType`, latitude and longitude. Latest tested creation and closure dates were **2026-05-28** despite advertised 30-minute refresh. A second production NEW layer returned no maximum creation date. | Not verified as a current feed or a complete annual history. The service's documented scope is open requests plus recently closed requests, which also biases historic closure statistics. Find a complete, current source before using per-capita volume or median closure days in scoring. Treat sentinel closure dates as missing. |
| [Residential building permits](https://data.houstontx.gov/dataset/residential-building-permits) | DataStore resource `c9cef716-4d81-4dac-9b05-d19acddf159f`; 264 rows. Fields `Year`, `Month`, `Single Family`, `Multi-Family`, `Residential`. Sample begins in 2004. | Citywide monthly counts with no address, geometry, or neighborhood field. Cannot supply neighborhood momentum. Find geocoded permits or use the plan's option to cut momentum. |
| [City flood hazard layers](https://mycity2.houstontx.gov/gisweb01/rest/services/HoustonMap/Flood_Hazard/MapServer) | Public ArcGIS service. Harris 100-year floodplain layer 1 returned 3,957 features; floodway and other county layers also exist. Effective map dates not yet verified. | Requires polygon preprocessing and explicit thresholds. A neighborhood-wide label cannot establish a particular property's flood exposure. Missing coverage must remain unknown. |

CKAN samples can be repeated from the repository root:

```sh
python backend/tools/houston_data.py sample 87dbbeba-91e3-4c81-a2a0-0e68a85770d5 --limit 2
python backend/tools/houston_data.py sample cbefe163-5305-474a-9160-b58cf3b4392a --limit 2
python backend/tools/houston_data.py sample c9cef716-4d81-4dac-9b05-d19acddf159f --limit 2
```

For ArcGIS feature counts, append `/query?where=1%3D1&returnCountOnly=true&f=json` to a layer URL. Inspect JSON errors even when HTTP status is 200. Counts and sampled fields demonstrate access, not completeness or suitability for scoring. Record source attribution and license terms before publishing snapshots.

## Phase 0 is still open

The plan's requirement for at least three portal datasets joined into the final score is **not yet verified**. City-published GIS data and portal-listed data are not automatically interchangeable for that requirement.

1. Confirm Super Neighborhoods as the common unit. Preserve geographic IDs as strings and normalize missing/suppressed ACS values before arithmetic. Choose a defensible method for affordability estimates; document any approximation and uncertainty.
2. Obtain population with a compatible geography and period for HPD and 311 rates. Select crime categories and annualization explicitly; handle missing/zero denominators without assigning a favorable score. The plan's "no demographic fields" wording needs an explicit exception for the population denominator if those rates remain in scope.
3. Replace or repair the 311 source; locate geocoded permits or cut momentum. Verify the selected sources' portal listings. Decide how unavailable metrics affect eligibility and weights before the demo.
4. Capture actual scoring snapshots with source URLs, resource/layer IDs, source periods, retrieval times, schema/version, and record counts. A snapshot preserves available data; it does not fix staleness or incompatible geography.

## Backend implications and proposed clarifications

- **Current architecture:** follow the build plan's shared TypeScript data client and scoring package, Houston Open Data MCP, Pitch MCP, and report JSON page. Workers/KV is proposed. Supabase/PostGIS could be useful for persistent spatial joins or relational data, but it is an optional architectural choice, not a dependency already chosen by the plan. No Hou Match Supabase project exists yet.
- **Reproducibility:** deterministic functions need pinned input data as well as stable code. Store data snapshot, scoring, and tax-reference versions with each report; use a consistent dataset version within one calculation. Live refreshes may change newly generated reports. Existing report JSON should keep its original numbers and provenance until expiration.
- **Frontend handoff:** define a fixture and the report contract in `docs/api.md` before either side wires the report page. Include source periods, fallback status, omitted metrics, units, assumptions, sponsor behavior, and 30-day expiration. That contract is not yet agreed.
- **Commute:** v1 returns straight-line miles. The plan's example "12 minutes" must not become a generated claim without routing data. Set a maximum for the 2-mile cap-widening loop and define the result when fewer than three neighborhoods qualify. Custom addresses also need a geocoding method; office presets can work first.
- **Scoring definitions:** agree on budget limits, normalization, crime-tier thresholds, flood thresholds, and missing-data handling. Unknown flood coverage must not become "Clear." Label candidate salary versus household income as a comparison of different measures; house multiples alone are not a mortgage affordability calculation.
- **Tax inputs:** verify dated federal/state/local reference tables and the exact origin geography, filing assumptions, and treatment of payroll/property taxes before implementing or publishing comparisons. This check has not yet validated those reference numbers.
- **Sponsor behavior:** resolve sponsor IDs through trusted configuration. For brokerage reports, omit the crime metric from scoring and returned report data, then renormalize the remaining weights as the plan describes. UI-only hiding would leave it in backend results. This is a product rule, not a conclusion that legal requirements have been satisfied.
- **Remaining specification:** the build plan references `docs/houston-open-data-mcp.md`, but that separate server plan is not present in the reviewed main branch. The four tools listed in the build plan are the available starting point.

The earlier [data research](neighborhood-data-research.md) documents optional parks, schools, weather, water, transit, and routing sources. Those are outside the current core report scope unless the team explicitly adds them.
