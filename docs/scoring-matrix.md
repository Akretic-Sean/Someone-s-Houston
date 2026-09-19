# Neighborhood comparison model

`houston-proximity-v1` is a deterministic, provisional comparison of Houston's 88 Super Neighborhoods. The browser and Node use the same dependency-free implementation in [`shared/scoring.mjs`](../shared/scoring.mjs); [`shared/scoring.d.mts`](../shared/scoring.d.mts) defines its input and output types. It ranks public reference measurements using the user's explicit preferences. It does not assess a person, predict outcomes or generate facts with an LLM.

## Data and calculation

Fetch `POST /rest/v1/rpc/get_neighborhood_scoring_data` with `{}` and the public `apikey` header. This read returns one complete cohort, approximately 152 kB before compression, rather than the approximately 4 MB detailed evidence response. It inherits the evidence RPC's expiry and source/boundary-version checks. No source download, write or external routing request occurs during scoring.

| Category | Raw default | Measurements used; lower is favored |
| --- | --- | --- |
| `afford` | 8 | Rent mode: estimated median monthly gross rent. Buy mode: estimated median home value. Both ACS 2020–2024. |
| `commute` | 7 | Straight-line distance to the selected `ion`, `downtown`, `energy`, `tmc` or `nasa` address proxy. |
| `flood` | 6 | Mapped 1%-annual-chance flood-zone area share (`sfha_area_pct`), only where coverage is validated. |
| `amen` | 5 | Nearest library, museum, community center and multi-service center distances. |
| `fit` | 7 | Nearest park and community center distances. |
| `food` | 8 | Nearest covered SNAP-authorized grocery-store distance. Dining is not included. |
| `air` | 6 | Distance to IAH, HOU, or the nearer of their two navigation proxies, as selected. |
| `health` | 7 | Nearest hospital, health facility and multi-service center distances. |

Facility measurements use the nearest known inventory record to the neighborhood reference point, including records outside the boundary. They are not counts, entrance routes, travel times or measures of service quality. Distances are meters. The detailed evidence API supplies the underlying names, sources and limitations.

For each selected measurement, compute a descending percentile from its valid values across the full 88-neighborhood snapshot: `100 × (number of worse values + (number of equal values − 1) / 2) / (n − 1)`. The smallest value is favored. Tied values receive the midpoint of their ranks; a constant or single-value distribution receives 50. Missing/expired values do not enter that measurement's reference distribution. Reference distributions do not depend on slider weights or a neighborhood's eligibility under other categories. Average component percentiles equally within each multi-component category. All required components must be available to score that category.

Then calculate:

```text
effective weight = chosen weight, except commute = 0 in remote mode
normalized weight = effective weight / sum(all effective weights)
category contribution = category score × normalized weight
total score = sum(category contributions)
```

The eight input weights must each be finite numbers from 0 to 10. Defaults total 54. All-zero effective weights are invalid, including remote mode with only commute selected. Remote mode disables commute for everyone and visibly renormalizes the remaining weights. Retain full precision for calculations; round for display only.

Percentiles are relative to this reference cohort, not absolute quality ratings. The selected office, airport or housing mode changes which measurements are compared; changing weights changes their contributions. `nearest` airport requires both airport measurements so missing data cannot look favorable. The model intentionally favors lower housing estimates; it does not yet evaluate a personal budget, bedrooms or complete ownership costs.

## Optional all-88 comparison

The additive `shared/scoring-coverage.mjs` wrapper provides an explicit common-coverage view. It removes any selected category missing for one or more neighborhoods **for everyone**, then invokes this same model with one common weight set. It returns omitted categories and affected IDs, retained priority weight, and the unchanged strict result. This is a reduced-criteria comparison, never a complete eight-priority score. No per-neighborhood reweighting or imputation occurs. See [Claude wiring and acceptance checks](all-88-frontend-guide.md).

## Missing values and ranking

A neighborhood missing any positive-weight category gets `totalScore: null`, `rank: null` and an explanation in `missingCategories`. It appears in `unranked`, never at the bottom with a fabricated zero. A zero-weight missing category does not prevent ranking. Do not redistribute weights differently for each neighborhood. Equal totals use canonical neighborhood ID as a stable display order; the tie is not evidence that one area is better.

With the current source edition, all defaults enabled, and offer mode, 82 neighborhoods can be ranked in rent mode and 83 in buy mode. Hidden Valley (7) lacks rent; IDs 17, 25, 41, 43 and 80 lack validated flood percentages. Counts can change after a source refresh or preference change. All 88 remain part of the reference dataset and can be shown on the map with their status.

Expired or `needs_refresh` evidence remains unavailable. The engine rechecks deadlines whenever invoked; the UI must invalidate displayed results when their data expire and refetch on resume as needed. Cache the compact cohort for at most one hour and no later than its applicable deadlines. Never preserve an old rank after a failed refresh by falling back to mocks.

## Shared code

```js
import { DEFAULT_WEIGHTS, scoreNeighborhoods } from './shared/scoring.mjs';

const result = scoreNeighborhoods(scoringPayload, {
  weights: { ...DEFAULT_WEIGHTS },
  tenure: 'rent',
  mode: 'offer',
  office: 'ion',
  airport: 'nearest'
});
// result.ranked: ordered recommendations with scores and contributions
// result.unranked: neighborhoods missing a positively weighted measurement
// result.effectiveWeights / normalizedWeights: the actual comparison weights
```

Import paths depend on the caller's location; keep this one shared implementation. `scoreNeighborhoods` validates the cohort, schema/model versions, categories, unique IDs, units, timestamps and input options. Mixed evidence versions, malformed cohorts and evaluation timestamps more than five minutes in the future are rejected. Fully expired evidence throws `NO_CURRENT_DATA`. Invalid input throws `ScoringValidationError`; do not suppress it with mock results. It returns category measurements, availability reasons, contributions and deterministic explanations. Use the output directly rather than having Claude invent or recalculate scores.

The existing `get_neighborhood_evidence` REST/MCP response deliberately retains `score: null` and `score_status: "not_implemented"`: that endpoint supplies raw evidence and does not receive user preferences. The shared model produces the new, separately labeled comparison scores. The optional scenario-comparison MCP tool uses the strict shared model; it does not automatically enable the all-88 view. No `/reports` persistence service is implied.

## Scope and verification

This version generates an in-session ranked report. It does not persist or share reports, deliver leads, calculate taxes/take-home pay, establish personal salary standing, infer safety tiers, produce drive minutes or use a narrative LLM. Current weather/gauges remain context and do not change the flood score. Source-backed explanations must retain these limits.

The optional Listing Watch dialog is independent of scoring. Its service is unconfigured, so no watch or email is created. Its browser-session correlation ID does not imply report persistence, and future listing/property results must not silently alter this model's neighborhood measurements.

Run backend and shared scoring tests, the frontend build and the public connection preflight as described in [the handoff](frontend-backend-handoff.md). In the browser, verify that weights, rent/buy, office and airport choices recompute the shortlist; remote mode omits commute; all-zero effective weights are rejected; missing/expired inputs withhold rankings; and no mocked claims are displayed. A build/preflight alone is not a rendered-browser or deployed-host test.
