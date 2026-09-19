# Server-side report model layer

The shared Deno module in `backend/supabase/functions/_shared/report-models/`
provides extraction and narration through Vercel AI SDK and OpenRouter. It does
not change the frontend, calculate rankings, store transcripts, or implement
`POST /reports`. The report pipeline imports this module after enforcing its
own user authorization and durable hourly quota.

## Pinned runtime

- `ai`: **6.0.286**
- `@openrouter/ai-sdk-provider`: **2.9.1** (the provider line for AI SDK 6)
- `zod`: **3.25.76**, isolated from the existing Node backend's Zod 4
- Local/CI Deno: **2.7.5**; transitive packages locked in `functions/deno.lock`

This deliberately uses the requested `generateObject` API on a compatible
SDK line. Do not independently bump the provider to v3: that line pairs with
AI SDK 7. Test the three direct packages together before upgrading. The SDK's
schema handling is followed by an explicit `schema.parse` and domain checks.

## Supabase configuration

Project: `hknzivrgihnqzvsafkkr`. Edge Function Secrets contain:

| Name | Purpose |
| --- | --- |
| `OPENROUTER_API_KEY` | OpenRouter credential; never copy to Git, logs, browser config or public tables |
| `OPENROUTER_EXTRACTION_MODELS` | Comma-separated primary then fallbacks; configured as `openai/gpt-4.1-mini,google/gemini-2.5-flash` |
| `OPENROUTER_NARRATION_MODELS` | Comma-separated primary then fallbacks; configured as `openai/gpt-4.1,google/gemini-2.5-flash` |

The factory forwards the complete ordered list through model `extraBody.models`
and `route: 'fallback'`. Provider routing requires structured-output parameters,
denies data collection, and requests zero data retention. If no eligible provider
is available, degrade rather than relaxing privacy. These flags constrain provider
routing; they are not a claim that all application logging/retention is disabled.

Use Supabase's Edge Function Secrets UI to rotate the credential. For local work,
copy `functions/.env.example` into an ignored env file and supply your own key.
No real credential is in this repository.

## Teammate integration

```ts
import { createReportModelClient, modelConfigFromEnv } from '../_shared/report-models/mod.ts';

// Construct ONCE per authorized report, not once per narrative section.
const models = createReportModelClient(modelConfigFromEnv(name => Deno.env.get(name)));
const extraction = await models.extract({ transcript, answers });
// Have the recruiter confirm extraction.data before applying ranking preferences.
// Compute ranking/evidence using the existing shared deterministic model.
const sections = await Promise.all(sectionInputs.map(input => models.narrate(input)));
```

`answers` uses the current 12 CandidateProfile keys. Each extracted field contains
`value`, `confidence`, and `evidence`. A quote must be an exact transcript substring;
unverified fields fall back to explicit form answers. Form answers always win.
Missing keys remain null. Quotes establish provenance, not semantic correctness:
review is still required, particularly for prompt-injected or ambiguous transcripts.

Narration inputs are `{ section, facts, preferences }`; each fact has
`{ id, label, value, source, refresh_due_at }`. Build these from server-validated,
currently available evidence only. Never trust a browser-supplied fact bundle.
Narration returns `{ prose, facts_used, preferences_used }` inside `data`.
Quantities appear as `[fact:ID]` placeholders. A renderer must substitute the
already formatted authoritative value for that ID and render everything as plain
text, never HTML. The verifier rejects unknown references, literal numbers, stale
evidence, and known unsupported claims. Phrase checks do not prove factuality or
fair-housing compliance; this is a model boundary, not a complete production
narrative quality gate. Add domain-specific evaluations before public rollout.

Results have `status: 'generated' | 'degraded'`. On model/schema failure, extraction
returns form-only data and narration returns null. Invalid caller inputs throw.
Nothing logs raw SDK errors, model output or transcripts: those errors may contain
private text and request details. If adding observability, record only bounded
reason codes, request IDs, token counts and spend; never raw errors or headers.

Each report client permits one extraction and up to six narration sections, each
with at most one narration retry. It reserves at most 12,000 output tokens across
calls, caps transcript/fact sizes, uses a 25-second deadline per call, and disables
SDK retries. OpenRouter itself may route to fallback providers/models. These are
request/token limits, **not a dollar ceiling**. Set an OpenRouter key spending cap
and enforce a durable user/hour quota before exposing a user-facing endpoint.
Recreating the factory per request cannot enforce a cross-request quota.

## Operator runtime check

`POST /functions/v1/model-runtime-check` is an operator-only synthetic smoke test.
It verifies an exact server-only key from `SUPABASE_SECRET_KEYS` in the `apikey`
header (or the legacy service-role bearer token). Gateway `verify_jwt=false` is
intentional: modern secret keys are not JWTs; the handler enforces authorization. Ordinary user sessions and public keys are rejected.
Use Dashboard → Edge Functions → model-runtime-check → Test, selecting the secret via **Add header options → Add secret key**. Body contents are ignored; only a fixed fictional transcript and fact
bundle go to OpenRouter. It makes two model calls, or three if narration retries.
Do not call this endpoint from the frontend or on a polling schedule.

- 200: `{ "ok": true, "extraction": "passed", "narration": "passed" }`
- 403: handler rejected non-operator credentials
- 405: wrong method
- 503: secret/model configuration missing
- 502: generation or validation failed; output contains only bounded reason codes

This endpoint certifies runtime compatibility and key connectivity, not the full
report pipeline or forced failover at the provider. The mocked transport test
asserts that the fallback array reaches OpenRouter unchanged.

## Checks and deployment

From repository root (Node 22+):

```sh
npx --yes deno@2.7.5 task --config backend/supabase/functions/deno.json check
npx --yes deno@2.7.5 task --config backend/supabase/functions/deno.json test
```

The tests mock network transport; no paid calls or live credentials are needed.
Deno tests permit environment access and hostname lookup because the SDK's gateway
module imports Vercel's OIDC package; they do not grant network access. The deployed
Supabase runtime check must pass independently of local tests.

Deploy `model-runtime-check/index.ts`, its handler and `_shared/report-models`
dependencies, with `functions/deno.json` as the import map and `deno.lock` included.
Use `verify_jwt=false` only with this exact operator-key authorization handler. Other future functions can reuse the same
module and environment secrets without bundling the key.

References: [OpenRouter provider compatibility](https://github.com/OpenRouterTeam/ai-sdk-provider),
[Supabase Edge secrets](https://supabase.com/docs/guides/functions/secrets),
[OpenRouter fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks).


Verified on 2026-09-19: both real OpenRouter calls passed inside the deployed
Supabase Edge runtime using synthetic inputs; an unauthenticated request returned
403. Ten local Deno tests passed, including SDK request/schema/fallback checks,
independent validation, degradation, token/call budgets, and operator authorization.
