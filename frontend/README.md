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

When configured, visitors can **Create account** with a username/password or

**Sign in**. Supabase Auth manages passwords and sessions; no email service is

required. Usernames are case-insensitive. See [auth setup](../docs/auth-setup.md)

for the internal Auth identifier, signup quota and hackathon recovery limitations.

Existing sessions restore on reload.

Sign-out and account changes clear in-session report state;

remote sign-out failures explicitly distinguish local logout from unconfirmed

logout on other devices.

Without configuration, the app opens the preference screen and reports that

live data is unavailable. It cannot generate a report from mocked data.

## Deploying to Vercel

`vercel.json` lives in `report-web/`, so the Vercel project's **Root Directory must be

set to `frontend/report-web`** — the Vite preset, `npm run build` and `dist` all come

from that file.

One-time dashboard setup:

1. New project, import this repository.

2. Root Directory: `frontend/report-web`.

3. Environment Variables, for **every** environment you build:

   | Name | Value |

   | --- | --- |

   | `VITE_SUPABASE_URL` | `https://hknzivrgihnqzvsafkkr.supabase.co` |

   | `VITE_SUPABASE_PUBLISHABLE_KEY` | the project's `sb_publishable_` key |

4. Deploy.

Vite reads these **at build time**, so changing one needs a redeploy.

**Do not skip step 3.** `src/lib/supabase.ts` returns `null` when either variable is

missing, and `App.tsx` gates on `supabase && !session` — a build without them has no

authentication at all and opens straight into the workspace. It fails open, quietly.

Username/password sign-in calls Supabase directly and does not need an email
redirect. Keep the project Site URL current for any future email flows.

The SPA rewrite sends unknown paths to `index.html`; static assets resolve ahead of it.

That is what will make `/r/:id` report links work once routing exists.

## Report flow

Optional notes are extracted by the authenticated `report-flow` Edge Function,

then reviewed and edited. The controls below the notes determine the ranking.

**Generate report** loads evidence and computes the ranking on the server before

requesting an AI explanation. **Continue with factual report** uses the same

scoring model without a paid model call. Both paths preserve missing-data rules.

See [the release checklist](../docs/hackathon-release.md) for backend deployment,

username signup, quotas and the exact Vercel handoff.

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
