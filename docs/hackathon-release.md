# Hackathon release: AI report flow

## Frontend owner: Vercel setup

No OpenRouter credential or backend admin key belongs in Vercel's browser config.

1. Connect Vercel to `Akretic/Someone-s-Houston`, production branch `main`.
2. Root Directory: `frontend/report-web`. The repository's `vercel.json` supplies
   Vite, `npm run build`, `dist`, and the SPA rewrite. Use Node 24.
3. Set these in Production and Preview, then redeploy:
   - `VITE_SUPABASE_URL=https://hknzivrgihnqzvsafkkr.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY=<project sb_publishable_ key>`
4. Open the PR preview. Sign in, extract a short fictional set of notes, review
   the answers, choose priorities, and Generate report. Check the explanation,
   supporting facts, ranking and detailed evidence. Test on a phone too.
5. Merge only after required CI passes. The connected production branch then
   deploys automatically; no additional Vercel environment variable is required
   for the AI endpoint. Confirm the live site is serving that deployment.

The current production Site URL/redirect in Supabase is
`https://someones-houston.vercel.app/`. Update Authentication → URL Configuration
if that primary address changes. The project API URL and key stay the same.

## Email login for the hackathon

The user selected Supabase's built-in email service to avoid another provider.
It can deliver only to project-team email addresses and has restrictive sending
limits. It does **not** provide unrestricted public signup. Do not invite demo
visitors as project administrators just to enable mail delivery.

The interface accepts numeric OTP codes and explains how to follow a sign-in
link if Supabase's default template sends one instead. With default templates,
links return to the configured production Site URL; use the production site for
that test. A previously signed-in user's existing session still restores.
For code-only email or non-team signups, configure custom SMTP and apply both
templates in [auth-setup.md](auth-setup.md). Do not disable email verification.

## Backend owner: one-time release

Deployed to `hknzivrgihnqzvsafkkr` on 2026-09-19: quota migration applied and
`report-flow` version 1 ACTIVE with JWT verification enabled. Hosted checks:
OPTIONS 204; missing/forged user token 401; quota execution denied to browser
roles and allowed to the server; quota-table RLS enabled. The signed-in paid
flow and real email delivery still require the controlled-account release test.
The steps below describe how to reproduce the deployment; they are already done
for the shared project.

1. Apply `backend/supabase/migrations/20260919224312_report_ai_quota.sql`.
2. Deploy the `report-flow` Edge Function with `verify_jwt=true`. Bundle the
   entire function folder, `_shared/report-models`, `functions/deno.json`,
   `functions/deno.lock`, and the repository's `shared/scoring.mjs` and
   `shared/scoring.d.mts`, preserving their repository-relative paths. Deploy
   before the frontend; the endpoint does not alter existing report reads.
3. Keep existing Edge secrets `OPENROUTER_API_KEY`,
   `OPENROUTER_EXTRACTION_MODELS`, and `OPENROUTER_NARRATION_MODELS`.
   Supabase supplies the Auth/API keys used server-side. No new secret is needed.
4. Verify OPTIONS succeeds, anonymous/forged tokens fail, and an authenticated
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

Browser tests mock Auth and model responses; they do not certify email delivery
or a paid live model call. The final production check must be performed with a
controlled account. Current shipping status and performed live checks belong in
the release PR, not inferred from passing mocks.

## Rollback

Revert the frontend PR or select the preceding Vercel deployment. The additive
endpoint/quota migration can remain: old clients never call them. No rollback
should erase Auth users or change the published neighborhood evidence.
