# Someone’s Houston frontend

Owner: @Oleggo1. The report app lives in `frontend/report-web/`.

**[Report app](https://app.astronix.io)** · [Public landing page](https://astronix.io) · [Integration handoff](../docs/frontend-backend-handoff.md)

## Stack and commands

React 19, TypeScript, Vite 7, Supabase Auth and Leaflet. Styles live in `report-web/src/styles.css`; the package has one npm lockfile. Use Node 22.12+ (or Node 24, as used by CI).

Run from `frontend/report-web/`:

```sh
npm ci
npm run dev        # http://localhost:5173
npm test           # data-client and evidence-validity tests
npm run typecheck
npm run build      # TypeScript and production bundle
npm run preview
npx playwright install chromium
npm run test:e2e    # login/report integration on desktop and mobile
```

GitHub Actions runs unit tests, the production build and browser tests for PRs and `main`. Browser tests intercept Supabase requests with synthetic fixtures; they do not create accounts, send email or certify a deployed Auth configuration.

## Configuration and login

Copy `report-web/.env.example` to ignored `report-web/.env.local`. Set the shared Supabase URL and `VITE_SUPABASE_PUBLISHABLE_KEY`. Never use an admin key. The same configuration powers login and public neighborhood reads.

When configured, visitors can **Create account** with a username/password or **Sign in**. Supabase Auth manages passwords and sessions; no email service is required. Usernames are case-insensitive. See [auth setup](../docs/auth-setup.md) for the internal Auth identifier, signup quota and hackathon recovery limitations. Existing sessions restore on reload.

Sign-out and account changes clear in-session report state. Remote sign-out failures explicitly distinguish local logout from unconfirmed logout on other devices. Saved records remain private to their owning account under database row-level security.

Without configuration, the app opens the preference screen and reports that live data is unavailable. It cannot generate a report from mocked data. Do not ship a build without the required environment variables.

## Deploying to Vercel

`vercel.json` lives in `report-web/`, so the Vercel project's **Root Directory must be `frontend/report-web`**. The Vite preset, `npm run build` and `dist` come from that file.

One-time dashboard setup:

1. Create a project and import this repository.
2. Set Root Directory to `frontend/report-web`.
3. Add these Environment Variables for **every** environment you build:

   | Name | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | `https://hknzivrgihnqzvsafkkr.supabase.co` |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | the project's `sb_publishable_` key |

4. Deploy and verify the configured report domain, `https://app.astronix.io`.

Vite reads these **at build time**, so changing one requires a redeploy. If either variable is missing, the Supabase client is not created and the login gate is inactive; the workspace still opens but live reports are unavailable.

Username/password sign-in calls Supabase directly and does not need an email redirect. Keep the project Site URL current for any future email flows. The SPA rewrite sends unknown paths to `index.html`; static assets resolve ahead of it. Public report-link routing is not implemented.

See [the release checklist](../docs/hackathon-release.md) for backend deployment, username signup, quotas and the Vercel handoff. A local build is not a deployment or a live acceptance test.

## Report flow

1. **Configure priorities:** choose rent/buy, work arrangement, office hub, airport and eight priority weights. Fully remote mode removes commute from the comparison. Optional notes are extracted by the authenticated `report-flow` Edge Function and reviewed before use; the controls determine the ranking.
2. **Preview rankings:** load the complete `get_neighborhood_access_scoring_data` envelope once, then call `scoreNeighborhoodsWithEstimates` from `shared/scoring-estimates.mjs`. This wraps the shared deterministic scorer and uses `houston-access-v2`. Priority changes reuse the cached cohort without another upstream data request.
3. **Generate report:** the authenticated function loads authoritative evidence and computes the same ranking before requesting an AI explanation. If narration is unavailable or its quota is exhausted, the server returns a factual report. If the AI request fails, the browser also falls back to the validated public-data client and shared scorer. Evidence must still pass freshness and validity checks; an AI fallback does not replace missing or expired data with mocks.
4. **Explore results:** view the shortlist, all-neighborhood ranking, map, category contributions, source dates and explicit missing-data states. Six neighborhoods have disclosed conservative source-derived ranking inputs; their original missing observations remain null. Reports retain the complete estimates envelope and display source ranges and badges.
5. **Save and reopen:** signed-in report generation attempts to save configuration and the original snapshot to `saved_reports`. The dashboard lists the user's private records. A failed save is shown explicitly with a retry; generating a report does not by itself prove it was saved. Reopening restores the saved priorities and recomputes against current evidence, rather than presenting the original snapshot as current.

Amenities and healthcare use full inventory counts within 3 miles of the neighborhood reference point, including facilities outside its boundary. Closer and more numerous facilities improve access through distance-weighted counts. Deploy the nearby-access migration and matching `report-flow` function before the frontend. See [the scoring policy](../docs/scoring-matrix.md) and [all-88 integration](../docs/all-88-frontend-guide.md).

The dashboard also has a separately labeled synthetic demonstration workspace. Its candidate scenarios can be calculated using current Supabase evidence; connector controls remain demonstrations and do not connect accounts.

## Geographic and public-safety context

The Leaflet map uses OpenStreetMap street tiles and the Supabase `get_neighborhood_map` RPC for simplified boundaries, joined by canonical neighborhood ID. Tiles, boundaries and reference-point markers share Web Mercator positioning. Teal markers show the shortlist; orange shows the workplace. Pan/zoom, fit-all, shortlist zoom and keyboard marker selection preserve the evidence-card flow. Boundary responses are validated, coalesced and cached for up to 24 hours; boundary or tile failures show separate retry controls without blocking ranking.

These are neighborhood locations, not parcels or navigational directions. Tiles load directly from OpenStreetMap with visible attribution and browser caching; no extra API key is required. Do not bulk-download or prefetch tiles. Follow the [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/) and arrange a suitable tile provider before scaling traffic. Browser tests mock tiles and Supabase. For an optional real-tile visual check, run `LIVE_MAP_TILES=1 npx playwright test -g "geographic map"` (POSIX shell); API/auth fixtures remain synthetic.

The public-safety panel uses selected historical 2024 offense counts from the relocation-context API. It preserves source limitations and remains separate from the weighted score; counts do not establish a crime rate or safety tier.

## Current boundaries

Public share links, measured route times, safety tiers, salary standing and personal financial comparisons are not implemented. Saved reports are private records, not public report URLs or an autonomous agent's memory. Unknown or expired evidence is withheld; only the documented source-bounded scoring path may use the explicitly disclosed conservative inputs.

Listing Watch retains the real ranked neighborhood IDs. Its optional webhook is unconfigured by default, so submission is disabled until a service is provided.

Read [the integration handoff](../docs/frontend-backend-handoff.md), [API contract](../docs/api.md) and [scoring method](../docs/scoring-matrix.md) for data meanings, cache deadlines and live acceptance checks.
