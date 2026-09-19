# Backend judging evidence and scenario comparison

The backend supports an Open Data demonstration today. Additional datasets alone do not close the remaining product gaps. This change makes the existing engineering and preference-dependent insight demonstrable without changing frontend contracts or spending on model calls.

| Judging area | Demonstrable backend evidence | Remaining product work |
| --- | --- | --- |
| Completeness / technical depth | 88 canonical neighborhoods, spatial joins, bounded imports, 704 category-evidence rows, 176 transit/crime summaries, source versions, permission and expiry tests; shared deterministic model | Verify the deployed site's complete user journey; optional context cards need frontend wiring |
| Open Data track | Actual Houston estimates, mapped flood coverage and named facilities, source periods/links, explicit gaps; live scenario tool explains preference tradeoffs | Show the source drawer and a concrete relocation decision during the demo |
| Agents track | Seven read-only tools, including deterministic scenario comparison | Tool availability alone is not autonomous reasoning or durable memory. Those are not demonstrated by this PR |
| Insight / usability | Signed category contributions explain the winner's margin; changes in priorities return changed ranks and missing-data exclusions | Present measurements and tradeoffs in plain language; route minutes, current listings and personal costs remain unsupported |
| Creativity / performance | Precompute spatial data once, reuse one compact scoring snapshot across priority changes, fetch evidence only for selected neighborhoods | The timing below is a sequential local-client sample, not load capacity or deployed-browser performance |
| Commercialization | Recruiter relocation decision support is the stated customer use case | Pricing, a buying moment, stored/shared reports and lead delivery are not completed by this backend change |

## Claude task

> Rebuild and reconnect the product MCP. Use compare_neighborhood_scenarios with my explicit baseline and alternative preferences. Explain the changed shortlist and the signed category contributions, then call get_neighborhood_evidence for the winners and match evidence_versions before citing dates and source URLs. Preserve missing-data exclusions. Do not describe proximity as route time or raw crime counts as safety. Do not claim saved reports, memory, autonomous actions or a buying flow from this tool. For browser integration, retain the existing scoring RPC and shared model; MCP is optional.

Example tool arguments:

```json
{
  "baseline": {
    "weights": {"afford":8,"commute":7,"flood":6,"amen":5,"fit":7,"food":8,"air":6,"health":7},
    "tenure":"rent", "mode":"offer", "office":"ion", "airport":"nearest"
  },
  "alternative": {
    "weights": {"afford":10,"commute":7,"flood":6,"amen":5,"fit":10,"food":8,"air":6,"health":7},
    "tenure":"rent", "mode":"remote", "office":"ion", "airport":"nearest"
  },
  "limit":3
}
```

This example changes work mode and two priorities together. Do not attribute the result to a single cause; for that comparison change only one input. Both scenarios use exactly the same snapshot. Rank differences can reflect changes in which neighborhoods have sufficient evidence, and are not causal predictions.

`winner_margin.total_points` is the first-place minus second-place weighted score. All eight signed category contributions sum to that margin; negative contributions favor the runner-up. A small margin warrants showing both options, not declaring a decisive winner. Returned facts and explanations use the existing model, never LLM arithmetic.

## Repeatable live proof

Configure the existing public `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in ignored `backend/.env`, then run from `backend/`:

```sh
npm run demo:proof
npm run test:live
```

The proof reads live Supabase, evaluates the example above and ten cached repeats, requires exactly one scoring request, checks deterministic results and remote-mode behavior, then reads source evidence for both winners and verifies matching versions. It prints JSON with provenance and measured timing. It fails without synthetic fallback. It makes no writes, uses no admin key, stores no candidate information, and makes no paid model requests. For JSON-only output after building, run `node --env-file-if-exists=.env tools/prove-backend.mjs`.

Verified September 19, 2026 at 22:12 UTC:

- First scenario pair including the public data read: **1,352 ms**.
- Ten cached scenario pairs: **17.25 ms median**, **19.24 ms maximum**, no extra scoring requests.
- Default offer/rent example: Greater Eastwood **81.14**, Pecan Park **80.99**, Greater Third Ward **78.14**.
- Remote mode with higher affordability/recreation priorities: Pecan Park **84.37**, Greater Eastwood **80.13**, Greater Third Ward **76.17**.
- Source evidence matched the ranking edition; live API and all seven MCP tools passed. Anonymous writes were denied.

These are dated measurements and rounded examples, not a performance SLA or permanent recommendations. Rerun before presenting. Current live feeds and reference-source expiry can change independently. The default matrix still leaves neighborhoods with required missing measurements unranked; this is intentional, not a complete-data claim.

## Next priorities

1. Finish the deployed end-to-end demo and optional evidence-card integration. This is more valuable now than another bulk import.
2. Show the before/after example, the close first/second margin, source periods, and a missing-data case.
3. If pursuing the Agents track, separately implement consented private report memory and an actual tool-driven reasoning workflow; do not label this deterministic utility an autonomous agent.
4. After the hackathon, address route times, current comparable housing costs, dining coverage and newer crime observations with appropriate provenance and methodology. Keep the current working scoring contract stable.
