# Current report priorities and usable evidence

The user's 2026-09-19 screenshot confirms the existing frontend category IDs and supersedes the earlier 25/20/10/15/15/7/5/3 draft. Current configuration: [report-priorities.v1.json](../backend/data/reference/report-priorities.v1.json), mirrored in Supabase `report_category_config`. Raw slider defaults total 54; normalize effective weights and round only for display. Remote mode disables commute globally.

**P0 ranking is implemented:** `get_neighborhood_scoring_data` provides a compact complete cohort and `shared/scoring.mjs` applies model `houston-proximity-v1`. The frontend generates an in-session ranked report. [The scoring contract](scoring-matrix.md) defines exactly which measurements below are scored, normalization, ties and missing-value behavior. Additional evidence does not imply it is used by this version's formula.

Safety remains outside the weighted matrix. There is no validated safety source or tier method, so the backend returns a null tier and unavailable status.

| Category | Raw default / display | Usable evidence | Remaining gaps |
| --- | --- | --- | --- |
| Affordability (`afford`) | 8 / 15% | Median rent/home value; housing type, bedrooms and construction-year counts/shares, all 88 neighborhoods, ACS 2020–2024 | Candidate inputs, current comparable listings, full housing costs, origin-city/tax calculation. Hidden Valley rent is null. |
| Commute (`commute`) | 7 / 13% | Five sourced office-hub address proxies and straight-line distances | Actual workplace/origin, route provider, departure window, office days and reliability. Drive minutes are null. |
| Flood context (`flood`) | 6 / 11% | FEMA coverage, effective panel/revision dates and mapped-area shares; 83 usable exposure summaries, five withheld | Property/drainage/insurance assessment; conflicting or incomplete map coverage. NWS/USGS is a separate operational overlay. |
| Local amenities (`amen`) | 5 / 9% | Libraries, museums, community and multi-service centers: counts and nearest named records | Hours, availability and individual preferences; counts are not walkability. |
| Fitness and recreation (`fit`) | 7 / 13% | Parks and community centers: counts and nearest named records | Verified gyms, trails, entrances and usable walking/cycling routes. |
| Dining and grocery access (`food`) | 8 / 15% | USDA SNAP grocery/supermarket/superstore subset: 380 records inside the neighborhoods, counts and nearest stores | Dining, non-SNAP stores, hours, prices, stock and dietary fit. |
| Airport access (`air`) | 6 / 11% | Sourced IAH/HOU navigation proxies and straight-line distances | Terminal-specific road times/departure window; flight schedules if used. This key means airport access, not air quality. |
| Healthcare access (`health`) | 7 / 13% | Hospitals, health facilities and multi-service centers: counts and nearest named records | Insurance networks, specialties, appointments, capacity and road access. |

These are usable facts with partial coverage of each broad category. The raw evidence API retains missing inputs, limitations, sources, dates and null scores; the separate shared model derives provisional scores from a fixed, documented subset: housing estimates, mapped flood area and proximity measurements. Never renormalize around different missing criteria per neighborhood. Missing any positive-weight category leaves a neighborhood unranked. With the current edition and default offer-mode weights, rent supports 82 ranked neighborhoods and buy 83; all 88 remain available with their status. No safety tier, route time or personalized financial claim is implied.

Use [the category-evidence contract and refresh guide](category-evidence.md) or the fifth product MCP tool: `get_neighborhood_evidence({"neighborhood_id":62})`. The earlier [matrix configuration](../backend/data/reference/relocation-matrix.v1.json) is retained only as a superseded draft.

Next priorities are cached routing, a reliable current dining inventory and candidate-specific affordability calculations. Transit, HUD bedroom rental benchmarks, gyms/trails and provider-network access can extend these categories. Earlier ideas such as permits, 311, noise and land-use remain optional extensions.
