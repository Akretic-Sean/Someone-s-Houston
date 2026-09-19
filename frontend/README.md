# Frontend

Owner: @Oleggo1.

| App | Folder | What it is |
| --- | --- | --- |
| `report-web` | `report-web/` | Recruiter dashboard, report builder, and the candidate-facing report page |

## Stack

React 19, TypeScript, Vite 7. No UI framework and no CSS library: design tokens and
component styles live in `report-web/src/styles.css`. Fonts (Instrument Serif, IBM Plex
Mono) load from Google Fonts.

One lockfile, in `report-web/`.

## Commands

Run from `frontend/report-web/`:

```sh
npm install      # prerequisites: Node 20.19+ or 22.12+ (developed on 23.11)
npm run dev      # http://localhost:5173
npm run build    # typecheck, then a static bundle in dist/
npm run preview  # serve the built bundle
npm run typecheck
```

There is no test runner yet. `npm run build` runs `tsc -b` first, so a type error fails
the build.

## How it is wired

The app is frontend-only and renders mocked data. Three screens, switchable from the bar
at the top of the page:

1. **Recruiter dashboard** — KPIs and the recent-reports table.
2. **Create report** — import a call transcript from a meeting-notes connector, review the
   extracted candidate profile (each field carries a confidence), set the office hub, the
   comparison mode and the priority weights.
3. **Candidate report** — the seven sections a candidate opens.

`src/types.ts` is the contract. It is the shape the backend has to return and the only
thing the component tree reads; `src/data/report.ts` is a mock that conforms to it. To go
live, replace the mock with a fetch — no component should need to change.

Every figure a candidate sees renders with a `source` line underneath. `source` is a
required field on the types that carry figures so it cannot be dropped by accident.

## Live neighborhood data

The neighborhood section reads the **live** City of Houston layer documented in
`../docs/api.md`: 88 Super Neighborhood profiles (median household income, median home
value, median gross rent, centroids) from ACS 2020–2024.

Copy `.env.example` to `.env.local` and fill in the publishable key:

```sh
cp .env.example .env.local
# VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

The key is a **publishable** application credential and is safe in browser code.
`src/config.ts` refuses to start if an `sb_secret_` key is configured.

Without the key the report still renders; the neighborhood section shows an explicit
"data unavailable" state instead. Nothing is ever estimated in its place. That is
deliberate: `null` renders as "Unavailable", dependent calculations are omitted, and
values are never backfilled with zero.

What is live vs. still mocked:

| Live from the City layer | Still mocked |
| --- | --- |
| Neighborhood names, joined on `neighborhood_id` | Scores, commute times, flood tier, services, momentum |
| `median_gross_rent`, `median_household_income`, `median_home_value` | The "why" prose and factor bars |
| Map positions, from real centroids | Everything in the financial comparison |
| The standing ratio (Houston pay ÷ median household income) | Lifestyle cards |

`src/data/neighborhoodApi.ts` mirrors the backend client's contract: one request for all
88 rows, shape validation, a 24-hour cache, coalesced concurrent requests, and no
fallback to an expired cache after an error.

### The map

`src/components/NeighborhoodMap.tsx` plots all 88 neighborhoods from their real
centroids, with the recommended three and the office picked out. Hovering or focusing a
pin, a legend entry, or a neighborhood card raises all three together and shows that
area's live figures.

Equirectangular projection with a cosine correction for longitude. It is for relative
placement only — not a navigational map, and centroids locate a neighborhood rather than
a parcel.

Coordinate contract changes through `../docs/api.md`. Keep server credentials out of
browser code — the neighborhood layer uses a publishable key, never an admin key.
