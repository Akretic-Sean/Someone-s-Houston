# Backend scenario comparison and performance

The read-only MCP scenario tool compares two explicit preference sets against the same public evidence snapshot and explains how category contributions change the result. It uses the strict `houston-proximity-v1` model through `get_neighborhood_scoring_data`; the current report app uses the separately documented [nearby-access model and conservative bounds](scoring-matrix.md). Do not treat the two policies as interchangeable.

This guide documents reproducible validation and dated timings. It does not establish production browser performance, AI latency, load capacity or a completed autonomous agent workflow.

## Claude task

> Rebuild and reconnect the product MCP. Use compare_neighborhood_scenarios with my explicit baseline and alternative preferences. Explain the changed shortlist and the signed category contributions, then call get_neighborhood_evidence for the winners and match evidence_versions before citing dates and source URLs. Preserve missing-data exclusions. Do not describe proximity as route time or raw crime counts as safety. Do not claim saved reports, memory, autonomous actions or a buying flow from this tool. For browser integration, use the current access-scoring RPC and bounded wrapper described in the frontend/backend handoff; MCP is optional.

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

## Interpreting the result

Show the before/after preference choices, the first/second score margin and the source periods together. A different ranking can reveal a tradeoff, but it is not a causal prediction or a guarantee about a neighborhood. Unknown measurements remain unranked under this strict comparison policy.

Private dashboard persistence is documented separately in [saved reports](private-saved-reports.md). The scenario tool itself does not save reports, deliver leads or maintain autonomous agent memory. Future data work can add route times, current comparable housing costs and broader dining coverage without silently changing this comparison contract.
