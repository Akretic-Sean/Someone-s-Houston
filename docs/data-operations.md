# Backend data operations

**Owner: @Akretic-Sean.** This includes housing, boundaries, facilities, groceries,
FEMA summaries, destination anchors, category evidence, and refresh alerts.
Oleggo1 consumes the public API and handles frontend availability displays; a
frontend deployment does not refresh reference data. Backend review ownership is
recorded in `.github/CODEOWNERS`.

## Deadlines and response

The September 19, 2026 release begins expiring **October 20, 2026**. Complete the
next reviewed refresh by **October 6**, then use the newly published
`refresh_due_at` values for subsequent deadlines. Review references at least
monthly and before each demo. Never extend a timestamp just to dismiss an alert.
The API deliberately withholds expired facts; the frontend must keep them unknown.

The `Backend data health` GitHub workflow checks every 15 minutes, offset from the
database refresh schedule. It uses only public reads and creates one issue
assigned to @Akretic-Sean when a feed is stale/unavailable, reference publication
is incomplete/inconsistent, or evidence is within 14 days of expiry. It updates
that same issue when findings change, closes it on recovery, and reopens it for
a recurrence. An unchanged problem produces no extra comments. Subscribe to the
assigned issue and enable GitHub notifications for failed Actions runs.

During the hackathon, inspect a critical alert promptly and before the next demo.
For an expiry warning, perform the reviewed refresh before the stated deadline.
If the owner is unavailable, explicitly hand ownership and the issue to another
backend maintainer; public frontend keys cannot publish reference data.

## Enable and verify monitoring

After this PR merges to `main`, GitHub enables the scheduled workflow. Under
Settings > Secrets and variables > Actions > **Variables**, configure:

- `SUPABASE_URL`: this project's HTTPS API base URL.
- `SUPABASE_PUBLISHABLE_KEY`: the public `sb_publishable_...` key.

No server key, database password, Vault token or paid monitoring service is
needed. The workflow's short-lived GitHub token has only repository read and
issue-write access. PR verification has no issue-write permission.

Run Actions > Backend data health > Run workflow on `main` once after merging.
A healthy run creates no issue. Missing configuration creates a critical issue
and fails the run. Bootstrap/npm or GitHub API failures also fail the run, but
cannot guarantee an issue; the owner must keep failed-run notifications enabled.
GitHub schedules can be delayed and public-repository schedules can be disabled
after 60 days of inactivity. Check that the workflow remains enabled after a
hiatus; this is a low-cost monitor, not a guaranteed delivery SLA.

The probe validates the actual current-context response, source/observation
expiry, and a small metadata projection of all 704 evidence rows. It checks
profile/facility/boundary dependencies as the evidence API does. It never fetches
all evidence facts, raw polygons, PDFs or vendor inventories. A fresh empty NWS
feed is healthy; no current USGS observations is actionable. A partial refresh
failure becomes visible when the retained data expires (30-minute feed lifetime),
plus the next monitor run and any scheduler delay. Cron enqueue success is not
treated as success, and this monitor does not inspect private HTTP response logs.

For a failure, inspect the Edge Function logs and the actual request ID in
`net._http_response`, then source dates in `live_context`. Follow
[live-feed maintenance](live-feeds.md). Fix the source/authentication/publication
failure, verify the public read, then let the next probe close the alert. Do not
paste credentials, private log bodies or candidate data into the issue.

## Reviewed reference refresh

Use an ignored backend `.env` with URL/public key for preparation and the
server-only publisher credential for publishing. Run commands from `backend/`:

```sh
npm ci --ignore-scripts
python -m pip install -r scripts/requirements-test.txt
npm run data:prepare
# Review economic source changes; publish only a validated edition.
npm run data:publish
npm run geo:prepare
# Review boundaries/inventories, then publish the matching editions together.
npm run geo:publish
python tools/prepare_housing.py --cache-dir data/raw/housing
python scripts/prepare_flood.py --cache-dir data/raw/fema
npm run groceries:prepare
# Manually verify operator addresses/geocoding in destination-anchors.json.
# Change checked_at only after completing that source review.
npm run evidence:prepare
npm test
npm run evidence:publish
npm run test:live
node --env-file-if-exists=.env tools/monitor-data.mjs
```

These are manual owner commands, not automated deployment steps. Review source
changes before each publishing command; do not download older annual editions
unless an explicit data requirement justifies them. If an upstream source is
unavailable, preserve the last verified release and its original dates, leave
the issue actionable, and allow expiry to hide facts until a valid refresh.

Housing `--offline` requires a valid cached retrieval receipt; filesystem mtime
never establishes freshness. An undated cache must be downloaded again online.
Receipts preserve retrieval time and identify the pinned PDF hash/URL. A changed
PDF edition requires review of the pinned hash and parser, not a hash bypass.
Evidence preparation verifies boundary bytes, manifest metadata, IDs, canonical
geometry version and vertex count before joining groceries. GeoJSON has LF Git
attributes so a Windows checkout preserves manifest bytes.

FEMA `--resume` and housing `--offline` are reproducibility tools, not a new
source check. See [category evidence](category-evidence.md) for interpretation,
coverage gaps, cache size and source-specific review steps. Reference publication
keeps one current compact release and all 704 evidence rows publish atomically.

## Complete PR verification

`Backend verification` runs on every PR and push to `main`: TypeScript build and
all Node tests; pinned Python dependencies, housing self-tests and discovered
Python tests; then all migrations and every plain SQL test against a disposable
local Supabase Postgres 17 container. No production credentials are needed.

Reproduce from the repository root (Docker must be running for SQL):

```sh
npm --prefix backend ci --ignore-scripts
npm --prefix backend test
python -m pip install -r backend/scripts/requirements-test.txt
python backend/tools/prepare_housing.py --self-test
python -m unittest discover -s backend/test -p '*_test.py' -v
python backend/scripts/test_database.py
```

The SQL harness uses committed profiles/boundaries and synthetic, relatively
dated evidence/feed fixtures. It tests grants/RLS, read contracts, expiry,
dependency changes, malformed imports and publication rollback. It disables the
test Cron job in the migration transaction before it can run and asserts no HTTP
requests were queued or sent. Cleanup stops only its randomly named test project.
SQL tests run locally, never against the hosted database. Live provider checks
remain a separate read-only monitoring concern, so vendor downtime cannot mask
a code regression or make an offline PR test depend on production availability.
