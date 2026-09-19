# Claude walkthrough: compare all 88 without filling unknowns

## What is ready

The existing public scoring RPC already returns all 88 neighborhoods. The strict eight-priority calculation currently ranks 82 in rent mode and 83 in buy mode. The new **explicit opt-in** `scoreAllNeighborhoods` wrapper ranks all 88 using only selected categories with complete current coverage across the entire cohort. It reuses the existing scorer and never invents measurements. No database migration, new key, paid API, server deployment or extra request is required.

This fixes inclusion in a comparable calculation; it **does not repair the missing source observations**. The strict scorer, database facts and existing UI behavior remain unchanged until the frontend opts in.

| Source gap | Neighborhoods | Consequence with current default weights |
| --- | --- | --- |
| Published median rent is null | Hidden Valley (7) | Rent-mode all-88 comparison excludes affordability for everyone |
| Validated flood percentages withheld for incomplete/conflicting mapped coverage | Eldridge / West Oaks (17), Alief (25), Fort Bend Houston (41), Kingwood Area (43), South Belt / Ellington (80) | All-88 comparison excludes flood for everyone |

Do not substitute home value for rent, regional rent for neighborhood rent, zero flood exposure, or an average score. Those would answer different questions or fabricate evidence.

## Copy this task to Claude

> Read docs/all-88-frontend-guide.md, docs/frontend-backend-handoff.md and docs/data-instructions.md on PR #14. Add an explicit “Compare all 88” view using shared/scoring-coverage.mjs and its TypeScript declarations. Keep the existing full-priority view, candidate settings and scoreNeighborhoods behavior. Reuse the current scoring-data fetch/cache. Show the returned notice, included/omitted criteria, original versus effective weights, and retainedWeightFraction next to results. Render comparison.ranked for the all-88 view, but do not claim these scores include omitted priorities. Preserve null rent/flood facts and source limitations in details. Handle NO_COMMON_CATEGORIES and expired data without mocks. Update every report-generation/recompute path consistently, run frontend tests/build and backend coverage tests, and verify the acceptance cases below. Do not change login, create a new database, use service credentials, merge unrelated PRs or edit the scoring formula.

## Wiring steps

1. Bring the PR branch changes into the frontend working branch using the team's normal reviewed workflow. Preserve teammate edits. Files required are `shared/scoring-coverage.mjs` and `shared/scoring-coverage.d.mts`; they import the existing shared scorer.
2. Continue fetching `get_neighborhood_scoring_data` once through the current data layer with the publishable key. The complete 88-row payload is required; never filter it to the shortlist before scoring.
3. Add the view choice separately from the eight user weights. Preserve requested slider values. Invoke the wrapper only when the user chooses all 88.

```ts
import { scoreAllNeighborhoods } from '../../../shared/scoring-coverage.mjs';

const coverage = scoreAllNeighborhoods(data.payload, config);
const rows = coverage.comparison.ranked; // 88 rows or a clear error
const reportNotice = coverage.notice;
const included = coverage.includedCategories;
const excluded = coverage.omittedCategories;
const retainedPercent = 100 * coverage.retainedWeightFraction;
// coverage.requested retains the original full-priority result, including exclusions.
// coverage.comparison.normalizedWeights are the actual displayed ranking weights.
```

4. In the current checkout, `frontend/report-web/src/App.tsx` calls the strict scorer in both recomputation and report generation. Find **all** call sites (`rg scoreNeighborhoods frontend/report-web/src`) and pass the selected view through each path; otherwise the preview and generated report can disagree. Do not mutate `config.weights`.
5. Keep the notice visible in the shortlist, generated report and any exported/shareable representation. Suggested label: **“All 88 — shared-data comparison”**. For the current default offer/rent settings show **“6 of 8 priorities; 74.1% of requested priority weight retained. Affordability and flood excluded from this comparison.”** Derive this text from the result, never hardcode counts or categories. Retained weight is not statistical confidence or data accuracy.
6. Keep existing rent, flood, sources and optional context cards. Unknown remains unknown. Omitted categories can still show available facts, but have zero contribution for **every** neighborhood in this view. Do not use explanations from the full-priority view to describe the all-88 total. Do not compare numeric scores between views as though the formula were identical.
7. Recompute when sliders, tenure, work mode, office, airport, snapshot or expiry change. Refetch and invalidate on resume/expiry using the current rules. If the common category set changes, show the updated notice and weights. If no selected category has full coverage, show `NO_COMMON_CATEGORIES` and offer the full-priority view or another user-selected priority; never silently add a priority.

## Expected live behavior with this edition

| Settings | Full-priority ranked | All-88 ranked | Omitted for all | Requested effective weight retained |
| --- | ---: | ---: | --- | ---: |
| Rent / offer defaults | 82 | 88 | Affordability, flood | 40/54 = 74.1% |
| Rent / remote defaults | 82 | 88 | Affordability, flood; commute already disabled by remote mode | 33/47 = 70.2% |
| Buy / offer defaults | 83 | 88 | Flood | 48/54 = 88.9% |
| Buy / remote defaults | 83 | 88 | Flood; commute already disabled by remote mode | 41/47 = 87.2% |

These counts are assertions for this dated edition, not permanent application constants. User preferences change retained weight. Future validated source repairs automatically restore categories with full coverage, without inventing fallback values.

## Acceptance checks

- Both views use the same live snapshot; all-88 shows exactly 88 unique IDs, including 7/17/25/41/43/80.
- Rent excludes affordability globally; buy restores it when current home values are complete. Flood remains excluded until all 88 have valid measurements or the user assigned it zero weight.
- Full-priority results remain unchanged. Missing measurements stay null in either view.
- A flood-only selection produces `NO_COMMON_CATEGORIES`; all-zero weights and remote/commute-only settings remain invalid. Never show an invented 88-row ranking on failure.
- Expired data cannot preserve a cached rank. A newly missing category changes the shared category set for everyone and must update the visible notice.
- Report and preview agree on view, ranks, normalized weights, omitted categories and source dates.

From the repository root:

```sh
npm --prefix backend test
npm --prefix backend run test:all-neighborhoods
npm --prefix frontend/report-web test
npm --prefix frontend/report-web run build
```

The live check requires the existing public environment variables or ignored `backend/.env`; it reads one scoring snapshot and verifies all four tenure/work-mode combinations. It makes no writes. Shared tests cover exclusions, equal criteria, preserved unknowns, expiry and no-common-category failures. Frontend rendering is the partner's remaining integration task.
