# Houston Watch

Shows Zillow listings from the `houston-watch-sale` / `houston-watch-rent` Apify tasks.

Next.js (App Router), TypeScript, Tailwind v4. No database.

## Setup

```sh
cp .env.local.example .env.local   # then add the Apify token
npm install
npm run dev
```

`.env.local` is gitignored; `.env.local.example` is committed so a teammate knows
what to set.

## The token never reaches the browser

`src/lib/apify.ts` imports `server-only`, so importing it from a client component
is a build error. The browser only ever talks to this app's own routes.

## Routes

| Route | Does |
| --- | --- |
| `GET /api/listings?type=sale\|rent` | Items from the task's last successful run. Cached 5 minutes. |
| `POST /api/run?type=sale\|rent` | Starts a run; returns its id and status. **Billable.** |
| `GET /api/run/[runId]` | Run status, for polling until `SUCCEEDED`. |

Errors come back as `{ error: { kind, message } }`. `kind: "no_run"` is the
expected state before a task has ever succeeded, and the UI says so rather than
showing an empty page.

## Notes

- The dataset shape in `src/lib/listing.ts` was taken from a real run, not
  guessed: prices are `listingPrice.amount`, addresses `listingAddress.full`,
  coordinates `coordinates.{latitude,longitude}`. Every field is still treated as
  possibly absent, and a missing value renders as unavailable rather than being
  filled in.
- Listings whose coordinates fall outside a rough Houston box are flagged, and a
  banner appears if any do — the saved Zillow search has pointed elsewhere before.
- Zillow's terms restrict automated scraping. This is a prototype; a licensed
  IDX/MLS feed is the production path.
