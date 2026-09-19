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

Coordinate contract changes through `../docs/api.md`. Keep server credentials out of
browser code.
