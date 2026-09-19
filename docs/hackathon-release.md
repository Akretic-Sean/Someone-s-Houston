# Hackathon release: AI report flow

## Frontend owner: Vercel setup

No OpenRouter credential or backend admin key belongs in Vercel's browser config.

1. Connect Vercel to `Akretic/Someone-s-Houston`, production branch `main`.
2. Root Directory: `frontend/report-web`. The repository's `vercel.json` supplies
   Vite, `npm run build`, `dist`, and the SPA rewrite. Use Node 24.
3. Set these in Production and Preview, then deploy the latest `main` commit:
   - `VITE_SUPABASE_URL=https://hknzivrgihnqzvsafkkr.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY=<project sb_publishable_ key>`
4. Open the PR preview. Sign in, extract a short fictional set of notes, review
   the answers, choose priorities, and Generate report. Check the explanation,
   supporting facts, ranking and detailed evidence. Test on a phone too.
5. Merge only after required CI passes. If Vercel Git deployment is enabled, the
   connected production branch deploys automatically. Otherwise, deploy the
   latest `main` commit from Vercel. No additional environment variable is
   required for AI or username signup. Confirm the live site has Create account.

The current production Site URL/redirect in Supabase is
`https://someones-houston.vercel.app/`. Update Authentication → URL Configuration
if that primary address changes. The project API URL and key stay the same.

This release keeps the frontend and AI endpoint on the same existing strict
scoring RPC/model. PR #14's additional source-bounded, all-88 ranking is a
separate integration: when adopting it, update both the frontend and
`report-flow` to carry the complete estimates envelope and disclose its bounds.
Do not combine an estimated frontend ranking with an explanation of the strict
server ranking. See [the all-88 integration guide](all-88-frontend-guide.md).

## Username login for the hackathon

New visitors create a username/password account and enter immediately. Returning
users sign in with those credentials. No email, SMTP, Google or code is required.
See [auth setup](auth-setup.md) for internal identifiers and password recovery limits.

## Backend owner: one-time release

The shared project is `hknzivrgihnqzvsafkkr`. Deploy the backend before the
frontend; existing public report reads remain compatible. Exact live verification
results are recorded in the release PR.

1. Apply `backend/supabase/migrations/20260919224312_report_ai_quota.sql`.
2. Apply the username signup quota migration and deploy `username-signup` with
   its handler, shared username module and Deno configuration. It verifies the
   project API key inside the handler (`verify_jwt=false`); public registration
   is limited to 50 attempts per rolling hour across the project.
3. Deploy the `report-flow` Edge Function with `verify_jwt=true`. Bundle the
   entire function folder, `_shared/report-models`, `functions/deno.json`,
   `functions/deno.lock`, and the repository's `shared/scoring.mjs` and
   `shared/scoring.d.mts`, preserving their repository-relative paths. Deploy
   before the frontend; the endpoint does not alter existing report reads.
4. Keep existing Edge secrets `OPENROUTER_API_KEY`,
   `OPENROUTER_EXTRACTION_MODELS`, and `OPENROUTER_NARRATION_MODELS`.
   Supabase supplies the Auth/API keys used server-side. No new secret is needed.
5. Verify OPTIONS succeeds, anonymous/forged tokens fail, and an authenticated
   confirmed user can extract and generate. Never call `model-runtime-check`
   from the frontend: that endpoint is operator-only.

The quota is six accepted operations (extraction plus generation combined) per
user per rolling hour, and one hundred across the project per rolling hour.
Duplicate request IDs do not start another model call; they return 409. Failed
AI attempts consume a reservation. Limits bound calls, not dollars. Users can
always choose the factual report without an AI call. The quota table stores only
user IDs, request IDs and timestamps; old entries are pruned after a day on an
accepted request. Profiles, notes and generated reports are not persisted.

## Verification commands

Run from the repository root with Node 24, Python 3, and Docker for SQL tests:

```sh
npm --prefix backend ci --ignore-scripts
npm --prefix backend test
npm --prefix frontend/report-web ci
npm --prefix frontend/report-web test
npm --prefix frontend/report-web run build
npm --prefix frontend/report-web run test:e2e
npx --yes deno@2.7.5 task --config backend/supabase/functions/deno.json check
npx --yes deno@2.7.5 task --config backend/supabase/functions/deno.json test
python backend/scripts/test_database.py
npm --prefix backend run test:frontend
```

Browser tests mock Auth and model responses; they do not certify a paid live
model call. The final production check must be performed with a
controlled account. Current shipping status and performed live checks belong in
the release PR, not inferred from passing mocks.

## Rollback

Revert the frontend PR or select the preceding Vercel deployment. The additive
endpoint/quota migration can remain: old clients never call them. No rollback
should erase Auth users or change the published neighborhood evidence.
