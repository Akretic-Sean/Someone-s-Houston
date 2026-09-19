# Relocation matrix: database readiness and storage plan

Audited against the hosted project's actual public tables on 2026-09-19. The user-provided 25/20/10/15/15/7/5/3 category weights total 100. The versioned starting configuration is `backend/data/reference/relocation-matrix.v1.json`. It is a configurable default, not a fixed formula, a deployed database table, or an implemented scoring engine. Submetric weights and normalization functions remain undecided.

## What is actually stored

The five public tables contain 88 economic profiles, 88 canonical boundaries, eight source manifests, 1,177 facility records, and two current-feed snapshots. Profiles have 2020–2024 estimated income/home value and rent; rent is available for 87 neighborhoods. Facilities include 374 parks. The 18:00 UTC refresh had 70 regional USGS gauges and zero active NWS alerts. Current-feed counts are transient and do not measure long-term neighborhood resilience.

**Two categories have partial relevant inputs; none has a complete validated category score.** This is a readiness assessment, not a 40%-coverage estimate: housing and lifestyle carry 40 weight points, but we cannot count their full weights as supported when their component variables are missing.

| Category | Weight | Stored and usable now | Missing before the complete category can be scored |
| --- | ---: | --- | --- |
| Housing Value & Fit | 25 | Neighborhood median gross rent/home value as labeled baseline context | Equivalent housing costs by tenure/type/bedrooms, housing-type/bedroom/year-built distributions, candidate budget/preferences and a comparison method. Current medians are not a new three-bedroom home's asking cost. |
| Commute & Time | 20 | Boundary/center geometry supports future origin selection only | Geocoded workplace, candidate office days and departure windows, routed travel-time estimates, and a defensible measure of variability/reliability. There are no travel-time rows. |
| Mobility & Accessibility | 10 | Geometry for future spatial joins | METRO stops/routes/active service summaries, rail access, existing bikeways with status, and an explicit access/car-dependence method. A map center is not an accessibility metric. |
| Infrastructure & Resilience | 15 | Current alerts/gauges as a separate operational overlay | Effective FEMA flood exposure with coverage/provenance, relevant complete 311 cohorts, created/closed/status dates, category definitions and resolution summaries. Current gauges cannot substitute for flood exposure. |
| Lifestyle & Urbanity | 15 | Park/facility locations and neighborhood membership | Park area/entrances or defensible access measures, trails/outdoor network, current land-use classifications and a defined mix calculation. Counts alone do not establish walkability or usable outdoor access. |
| Development & Optionality | 7 | No imported scoring inputs | Geocoded permits, issued/status dates, permit class, units and deduplication keys; new-housing stock or completion measures; comparable recent and prior periods. |
| Environmental Friction | 5 | No imported scoring inputs | Dated airport noise contours and roadway/high-injury exposure layers with defined proximity/overlap methods. Proximity alone does not measure sound or individual crash risk. |
| Regional Connectivity | 3 | Frontend hub names only, not a geocoded database layer | IAH/HOU terminal and hub coordinates; routed time/distance by mode and travel window. Reuse routing infrastructure from commute, with separate destination purpose. |

The frontend's existing categories (`afford`, `commute`, `flood`, `amen`, `fit`, `food`, `air`, `health`) and raw defaults (total 54) differ from this matrix. Do not silently normalize them to 100 or treat them as the same categories. Frontend controls, report types, API and scoring configuration need one coordinated contract change. In particular, existing `air` means airport access, not air pollution or airport noise.

## Proposed storage design

Reuse existing neighborhood IDs, boundaries and provenance. The following are proposed additions, not tables already provisioned:

| Storage group | Key information | Why separate it |
| --- | --- | --- |
| Metric definitions and source metadata | Metric ID/category/unit/direction, selected source/release, geography, denominator, method version, observation/effective period, freshness and coverage requirements | Stops a raw source number from being mistaken for a ready score. Extend provenance for sources beyond the current eight facility manifests. |
| Housing segments and neighborhood metrics | Neighborhood ID, metric ID or housing segment, value/unit, coverage/status, data/method/boundary version and source references | Preserve bedrooms/type/age distinctions; publish compact summaries for all 88 neighborhoods. Independent ACS distributions do not establish a joint inventory of new three-bedroom townhomes. |
| Reference destinations and route cache | Verified office/hub/airport/park-access points; origin/destination, mode, weekday/departure bucket, typical/peak duration where supported, reliability method/sample coverage, provider, checked/expiry times | Commutes are origin–destination/time-specific, not a single permanent neighborhood property. Cache shared hub routes subject to provider storage terms. |
| Scoring profiles and report versions | Profile ID/version, the eight default weights, candidate-selected weights, submetric rules/thresholds, data/method versions and coverage | Users can change priorities without rewriting source data or losing reproducibility. Keep requested and effective weights separate. |
| Candidate inputs and private reports | Tenure, budget, bedrooms/type/age preference, geocoded employer, office days, travel window/mode, airport preferences and selected weights | These are user inputs, not City datasets. They need separate authorization; do not copy public City-data read policies onto personal records or candidate-specific route caches. |

A public reference metric row should identify `neighborhood_id`, `metric_id`, `value`, `unit`, `availability`, `source_id`, `source_period`, `effective_from` where relevant, `checked_at`, `coverage`, `boundary_version` and `method_version`. For a missing value, store null plus the reason. Some measures require a distribution, a housing segment or a route result instead of one scalar; the API must preserve that scope.

The fast path remains: bounded source import → validated spatial/time aggregation → compact Supabase reads → deterministic calculation using candidate inputs → explanatory output. No upstream dataset download should happen per candidate. A shortlisted address can refine a neighborhood estimate later; a single neighborhood center cannot promise the commute or flood exposure of every home.

## Scoring rules to establish before launch

- Store the user's default weights exactly; accept explicit preference changes and validate the total. Do not infer weights from protected demographic characteristics or the demographics of a neighborhood.
- Define the per-metric preference/utility function and within-category weights before generating numbers. Newer housing is not universally better, and a count of amenities is not automatically a quality score.
- Keep requested importance separate from data completeness. Missing/stale values must not become zero, a neutral score, or a favorable match. A required criterion with unknown data should yield an insufficient-data/needs-review result.
- If optional criteria are omitted for an exploratory comparison, use the same eligible metric set across every compared neighborhood, show the omitted criteria and original weight coverage, and label any renormalized score as a partial comparison. Never rescale each neighborhood using its own available fields. Until submetric weights/methods are defined, do not publish a numeric “coverage percentage.”
- Expose category results, source dates and missing-data reasons alongside any future total. Record the scoring version and final user weights so the result can be explained/reproduced.
- Avoid double-counting: assign daily employer travel to commute and airport/other-hub travel to regional connectivity; park access to lifestyle and transport-network availability to mobility. Define how land-use mix and car dependence interact rather than awarding duplicate points for the same measurement.
- Claude calls implemented read/calculation functions and explains returned results. It must not invent the absent category scores or infer flood resilience from the live gauge feed. The current four MCP tools provide context, not this scoring engine.

## Implementation order for this matrix

1. **Housing fit (25):** first extend the same City-prepared 2024 source using its [units-in-structure](https://houstontx.gov/planning/Demographics/sn-demographics-2024/11-Units-in-Structure-2024.pdf), [bedrooms](https://houstontx.gov/planning/Demographics/sn-demographics-2024/12-Bedrooms-2024.pdf), and [year-built](https://houstontx.gov/planning/Demographics/sn-demographics-2024/13-Year-Structure-Built-2024.pdf) tables. Actual rows for the 88 neighborhoods were verified, matching our geography and period. Extract only 2024 columns and validate all IDs, units and missing estimates. Census's [B25024](https://api.census.gov/data/2024/acs/acs5/groups/B25024.html), [B25041](https://api.census.gov/data/2024/acs/acs5/groups/B25041.html), [B25034](https://api.census.gov/data/2024/acs/acs5/groups/B25034.html) and [rent-by-bedroom B25031](https://api.census.gov/data/2024/acs/acs5/groups/B25031.html) are alternatives/additional detail with margins, annotations and an explicit census-geography crosswalk. Do not average block-group medians. HUD adds bedroom benchmarks by ZIP; parcels can add structure/age characteristics after validation. Comparable asking costs need a separately verified current source or a clearly labeled modeled benchmark.
2. **Commute (20) and connectivity (3):** geocode a small reviewed destination set and establish a route provider, departure scenarios, caching permissions and budget before making calls at scale. In-office frequency is an explicit candidate input; a weekly time calculation can use return-trip duration times office days once both direction estimates exist. Historical reliability needs provider distributions or validated observations; repeated static routes do not establish it.
3. **Resilience (15):** validate/import the effective FEMA geometry and prepare neighborhood overlap/coverage. Keep 311 resolution scoring unavailable until a complete, current cohort is verified. Resolved-case duration alone can hide a backlog; track open-case age and closure coverage separately.
4. **Mobility (10) and lifestyle (15):** METRO summaries, existing-bike network and land-use/park-access aggregates. The eight imported facility sources can be reused, but new derived metrics need methods and provenance.
5. **Development (7) and environmental friction (5):** add current, spatially usable permits and dated noise/road-injury layers only after their definitions/coverage pass validation. A permit is an authorization, not proof of a completed dwelling.

Housing, commute and resilience account for **60 of the 100 default weight points**, so closing their gaps takes priority over accumulating more generic facility records. See `docs/next-data-sources.md` for access checks and remaining blockers. The source order there is a general report roadmap; this matrix refines implementation priorities.

## Additional sources checked for this matrix

These checks establish source candidates, not new imported metrics:

| Official source | Useful contribution and observed limitation |
| --- | --- |
| [City 2024 neighborhood tables](https://houstontx.gov/planning/Demographics/sn-demo-tables-2024.html), including [vehicles available](https://houstontx.gov/planning/Demographics/sn-demographics-2024/29-Household-Size-by-Vehicles-Available-2024.pdf) | Housing distributions and vehicle-availability context for the same 88 areas. Separate distributions cannot establish a specific combined housing segment, and vehicle ownership is not a direct transit-access measurement. |
| [City Landuse layer 0](https://mycity2.houstontx.gov/gisweb01/rest/services/HoustonMap/Landuse/MapServer/0) | `SNBR_ID`, `GROUP_DSCR`, `LANDUSE_DSCR`, `YR_IMPR`, `ACREAGE`, `TAX_YEAR` and geometry. The regional layer contains 1,773,341 parcels: 1,546,552 with tax year 2026; 85,003 with 2025; 141,786 missing. Aggregate selected classifications for the 88 neighborhoods, retaining vintage/missing coverage. Validate assigned neighborhood IDs, stacked parcels and area denominators; avoid a million-row copy or owner/mailing fields. Tax/improvement year is not automatically the original construction year. |
| [High-comfort bikeways](https://mycity2.houstontx.gov/gisweb01/rest/services/HoustonMap/Transportation/MapServer/7) and [low-comfort bikeways](https://mycity2.houstontx.gov/gisweb01/rest/services/HoustonMap/Transportation/MapServer/8) | Working APIs; existing-status filters returned 2,216 and 669 segments. Exclude programmed/proposed/null status from existing-network measures and deduplicate overlaps. Description says updated 2021-12-14; latest existing date was 2022-12-02, so newer coverage requires checking before a current-network score. |
| [Vision Zero HIN 2022](https://mycity2.houstontx.gov/gisweb01/rest/services/HoustonMap/Transportation/MapServer/22) | 1,261 high-injury road segments based on 2018–2022 crashes. Usable as a dated designation overlay; not present-day crash likelihood. Preserve mode definitions and do not use rate fields with unknown denominators. |
| [65 DNL airport contours](https://mycity2.houstontx.gov/gisweb01/rest/services/HoustonMap/Transportation/MapServer/18) and [airport compatibility context](https://www.fly2houston.com/airport-business/resources/regulatory-policy/compatible-land/) | Three polygons; no effective date or airport identity field in the inspected GIS layer. Confirm vintage/meaning with the airport source before scoring overlap. Outside the contours does not establish quiet conditions. |
| [Activity centers](https://mycity2.houstontx.gov/gisweb01/rest/services/HoustonMap/Planning_and_Development/MapServer/39) | Public reference polygons including Westchase, Energy Corridor and Texas Medical Center; vintage unspecified. Verify destination access points and compute routes separately. |
| [Weekly permit report](https://houstontx.gov/planning/Publications/listsrv/WebeReport.html) | Returned September 7–14, 2026 addressed permit records, but no stable geocoded bulk history was verified. The [publication policy](https://www.houstontx.gov/planning/DevelopRegs/dev_reports.html) says permit-link support stopped December 1, 2025. Continuity, geocoding, residential units and amendments remain validation work; plat applications are not issued permits or completed homes. |

Prefer the working `gisweb01` URLs above; some indexed alternate services were unavailable or access-restricted during verification.

## Keep only relevant data

- Housing characteristics: one latest compatible release/current inventory. An old construction year is a current property attribute and remains useful; it is not a reason to discard that home or ingest decades of prior releases.
- Routes: bounded shared destination/scenario caches with provider-permitted expiry; do not collect every possible pair or a continuous location history.
- Flood/noise/network layers: latest verified applicable edition with its actual effective/observation date; preserve unknown coverage.
- 311: proposed latest 12 complete months with current/cohort coverage checks. Permits: proposed latest 24 complete months for a comparable 12-vs-12 trend. These windows do not make an incomplete source adequate.
- Neighborhood metrics: compact versioned summaries and source references; retain only versions needed for rollback or unexpired reports under the existing retention policy.

This audit adds the default configuration and implementation plan only. It does not provision these proposed tables, import missing sources, change the frontend's current controls, or publish a 100-point score.
