# Claude walkthrough: all 88 with all priorities retained

The report frontend now uses this envelope for previews and factual reports.
AI generation opts into the same policy through `report-flow` using
`scoringPolicy: "source-bounded-v1"`; old requests remain strict for compatibility.
Both paths display the source bounds separately from original evidence.

This replaces the rejected category-exclusion approach. The `scoring-coverage` wrapper has been removed from PR #14. **Do not exclude affordability or flood from everyone.**

## What fills the six ranking gaps

Original missing observations remain null. Six additional source-backed **conservative ranking inputs** live separately in `neighborhood_gap_inputs`. They are not fabricated measurements or exact-data repairs.

| Neighborhood | Official source information | Ranking input |
| --- | --- | --- |
| Hidden Valley (7) | City ACS 2020–2024 gross-rent table: all 110 estimated rent-paying units fall in the $1,500–$1,999 band; exact median suppressed | $1,999/month, upper endpoint of that published band |
| Eldridge / West Oaks (17) | FEMA mapped-SFHA classification interval 71.6074–73.6277% | 73.6277% |
| Alief (25) | FEMA interval 44.9031–44.9938% | 44.9938% |
| Fort Bend Houston (41) | FEMA interval 1.4375–2.9618% | 2.9618% |
| Kingwood Area (43) | FEMA interval 42.6363–42.7513% | 42.7513% |
| South Belt / Ellington (80) | FEMA interval 17.9050–18.2170% | 18.2170% |

The rent source is [City Gross Rent 2024, page 1](https://www.houstontx.gov/planning/Demographics/sn-demographics-2024/6-Gross-Rent-2024.pdf). 110 is an estimated housing-unit count, **not** survey sample size. The [City median table](https://www.houstontx.gov/planning/Demographics/sn-demographics-2024/8-Median-Gross-Rent-2024.pdf) explains suppression. The band is not a statistical confidence interval or current asking rent.

Flood bounds are computed from fresh complete [effective FEMA NFHL](https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28) polygon queries, effective panels and availability geometry using the canonical full-precision neighborhood boundaries. Unknown/uncovered/conflicting geography is excluded from the lower bound and included in the upper bound. Overlap with both moderate and minimal-hazard classes is checked; this reveals more uncertainty than the old moderate-only conflict check. The widest current interval is 2.0203 percentage points. The importer rejects intervals wider than five percentage points instead of silently publishing arbitrary values. Bounds address map-classification ambiguity only; they do not cover all model uncertainty or predict whether a property floods. Denominator includes water and nonresidential land.

Upper endpoints are a deliberately conservative scoring assumption because the existing model favors lower rent/exposure. They can disadvantage a neighborhood relative to its unknown exact value. They are not best estimates. Retain that disclosure and the source interval whenever showing affected scores.

## Copy this to Claude

> Read docs/all-88-frontend-guide.md and docs/frontend-backend-handoff.md from PR #14. Replace the rejected shared-coverage/category-exclusion proposal with the source-bounded scoring integration. Fetch get_neighborhood_scoring_data_with_estimates using the existing public key, cache its envelope, and score with scoreNeighborhoodsWithEstimates from shared/scoring-estimates.mjs. Keep all user weights, including affordability and flood; retain the existing remote-mode rule. Show the returned estimate badges, source ranges and conservative-upper-bound explanation for the six affected neighborhoods. Never call the $1,999 input a published median or a flood bound an exact exposure/risk probability. Preserve original null facts in the evidence cards, with a separate ranking-input line. Update both preview and report-generation call sites, validate/cache/expire the envelope correctly, run the tests below, and verify 88 ranked IDs in rent/buy and offer/remote. Do not alter login or use admin keys. Do not fall back to fabricated or expired data.

## Fetch once and calculate locally

```ts
import { scoreNeighborhoodsWithEstimates } from '../../../shared/scoring-estimates.mjs';

const response = await fetch(
  `${SUPABASE_URL}/rest/v1/rpc/get_neighborhood_scoring_data_with_estimates`,
  {
    method: 'POST',
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(15000),
  }
);
if (!response.ok) throw new Error('Scoring data unavailable');
const envelope = await response.json();
const result = scoreNeighborhoodsWithEstimates(envelope, config);
// result.ranked: 88 with current complete receipts and default priorities.
// result.effectiveWeights: original priorities; remote commute still becomes 0.
// result.estimateInputsUsed: source URL, period, bounds and receipt for used inputs.
// row.dataQuality: includes_conservative_bound | reference_measurements.
// row.estimateInputsUsed: bounds used for this specific neighborhood.
```

The response is `{schema_version:1, policy_version:'source-bounded-v1', base:<existing scoring payload>, estimates:[...]}`. It is deliberately a separate RPC so old clients cannot mistake substituted numbers for measured medians. **Do not pass the envelope to the old scorer or discard its estimates metadata.** No new credential, paid API or per-slider network call is required. The original scoring RPC and strict model remain available for auditing; they still preserve the six missing observations.

1. Reuse the frontend data/auth layers. Adapt their payload type and validation to store the complete envelope rather than just `base`. The shared `.d.mts` declaration exposes the result type. The existing strict payload validator applies to `envelope.base`; the new scoring wrapper validates estimate policy, source URLs, approved IDs, ranges, dates and evidence versions.
2. Find **all** `scoreNeighborhoods` calls in `frontend/report-web/src` (currently preview/recompute and report generation in `App.tsx`). Route both through the new wrapper using the same envelope and unchanged config. Use its returned explanations and weights.
3. On each affected card/report show **“Includes a conservative source-derived estimate”**, the category-specific range, ranking endpoint and source link/period. On Hidden Valley's evidence card keep **“Exact median unavailable”** and add **“Ranking uses $1,999 upper end of the published $1,500–$1,999 band.”** Do not overwrite the median field with that endpoint. Buy mode uses the published home value and does not consume the rent input.
4. Keep the category sliders unchanged. No categories are removed globally. The original normalizations, office/airport handling and remote-mode behavior remain in the shared scorer.
5. Cache at most one hour and no later than the earliest usable base **or estimate** deadline. Recompute on slider/config changes and after tab resume. Refetch at expiry. Do not assume 88 forever: expired/mismatched estimates leave their metrics null and the corresponding rows unranked. Never reuse an earlier result after a failed refresh.
6. Source changes matter: the database binds these inputs to the reviewed boundary and evidence versions. Publishing a new evidence edition invalidates them; rerun the importer/review/publication. Do not merely update dates. More recent valid observed values take precedence automatically.
7. The current `compare_neighborhood_scenarios` MCP tool still uses strict observed inputs. It is not the new browser scoring path. Claude should use this walkthrough for the frontend rather than copy an old MCP shortlist or invent a formula.

## Verify

```sh
npm --prefix backend test
npm --prefix backend run test:all-neighborhoods
npm --prefix frontend/report-web test
npm --prefix frontend/report-web run build
```

The live command uses the existing public-key configuration in `backend/.env` or process variables. It checks 88 ranked neighborhoods in all four rent/buy × offer/remote scenarios, affordability/flood weights retained, six inputs used for rent and five for buy, and the original Hidden Valley median still null.

UI acceptance: report and preview agree; all 88 canonical IDs appear; affordability and flood remain weighted; changing rent to buy removes Hidden Valley's rent estimate badge; source bounds stay visible on affected reports; unavailable/expired estimates and source outages never become zero or safe. No deployed-browser validation is implied by CLI checks.

## Backend refresh and audit

`backend/tools/prepare-gap-inputs.py` downloads the City PDF and targeted FEMA geometry using the existing bounded downloader. It checks the boundary hash, complete source ID sets before/after, geometry and dates. Reproduce with the existing Python virtual environment, then review `backend/data/neighborhood-gap-inputs.json`. This committed file is a reproducibility artifact, not a runtime fallback.

Publish its six `rows` through service-only `publish_neighborhood_gap_inputs(p_rows)`. Publication is atomic and enforces approved neighborhoods, sources, ranges and freshness. Public clients have read access only. `get_neighborhood_scoring_data_with_estimates` withholds expired/boundary/evidence-mismatched rows; the shared wrapper also checks validity locally. Receipts expire 31 days after actual retrieval. The reference refresh runbook must include these inputs when refreshing the main evidence edition.
