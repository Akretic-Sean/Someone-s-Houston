# Frontend

Owner: @Oleggo1. The report app lives in `frontend/report-web/`.

## Stack and commands

React 19, TypeScript, Vite 7 and Supabase Auth. Styles live in
`report-web/src/styles.css`; the package has one npm lockfile. Use Node 22.12+
(or Node 24, as used by CI).

Run from `frontend/report-web/`:

```sh
npm ci
npm run dev        # http://localhost:5173
npm test           # scoring-client and evidence-validity tests
npm run typecheck
npm run build      # TypeScript and production bundle
npm run preview
npx playwright install chromium
npm run test:e2e    # login/report integration on desktop and mobile
```

GitHub Actions runs the unit tests, production build and browser tests for PRs
and `main`. Browser tests intercept Supabase requests with synthetic fixtures;
they do not create accounts, send email or certify a deployed Auth configuration.

## Configuration and login

Copy `report-web/.env.example` to ignored `report-web/.env.local`. Set the shared
Supabase URL and its `VITE_SUPABASE_PUBLISHABLE_KEY`. Never use an admin key.
The same configuration powers login and public neighborhood reads.

When configured, signed-out visitors see email/password sign-in or account
creation. Enable email/password auth in the shared project's Auth settings and
allow the deployed app origin as a confirmation redirect. Confirmation-required
signup returns to sign-in until the user confirms their email. Existing sessions
restore on reload. Sign-out and account changes clear in-session report state;
remote sign-out failures explicitly distinguish local logout from unconfirmed
logout on other devices.

Without configuration, the app opens the preference screen and reports that
live data is unavailable. It cannot generate a report from mocked data.

## Report flow

- **Configure priorities:** rent/buy, work arrangement, office hub, airport and
  eight priority weights. Fully remote mode removes commute from the comparison.
- **Neighborhood report:** live inputs from `get_neighborhood_scoring_data`, ranked
  by `shared/scoring.mjs`, with the top five, all 88 neighborhoods, source evidence
  and explicit missing-data states. Inputs recalculate from the cached cohort.
- **Sample dashboard:** labeled demonstration records and connector controls.

The map plots actual reference points using a cosine-corrected projection.
These are neighborhood locations, not parcels or navigational directions.

Reports are kept only in the current browser session. Saved/shareable reports,
private candidate storage, route times, safety tiers, salary standing and personal
financial comparisons are not implemented. Authentication alone does not create
private-data authorization. Unknown or expired evidence is withheld, never
replaced by a favorable zero or an estimate.

Listing Watch retains the real ranked neighborhood IDs. Its optional webhook is
unconfigured by default, so submission is disabled until a service is provided.

Read [the integration handoff](../docs/frontend-backend-handoff.md),
[API contract](../docs/api.md) and [scoring method](../docs/scoring-matrix.md)
for data meanings, cache deadlines and live acceptance checks. Configure the
same public variables in the frontend deployment's build environment before
building; a local build does not deploy the app.
