# Shared API contract

Status: **proposed by the frontend, not yet agreed.** Nothing here is implemented.

The frontend (`frontend/report-web`) renders against mocked data that conforms to the
TypeScript types in `frontend/report-web/src/types.ts`. Those types are the normative
shape; this file is the prose version for the backend owner to agree, amend, or reject.

Open questions for @Akretic-Sean, listed here rather than assumed:

- Base URLs, local and deployed, and whether the two run on separate origins (CORS).
- Whether report reads need any auth. The build plan says a report is reachable by
  unguessable ID with no login, which implies none on `GET /reports/:id`.
- Whether the recruiter-side endpoints need auth. Presumably yes.
- Whether scoring runs server-side only. The frontend does no scoring and should not.

## Conventions

- JSON in, JSON out, `Content-Type: application/json`.
- Errors: HTTP status plus `{ "error": { "code": string, "message": string } }`.
- Every figure intended for a candidate carries a `source` string. This is required, not
  optional — the report page prints it under the number.
- No demographic fields in any payload, in either direction.

---

## `GET /reports/:id`

- Status: proposed
- Purpose: fetch a stored report for the candidate-facing page.
- Authentication: none, if IDs are unguessable and reports expire. To confirm.
- Request: no body.
- Success: `200` with a `Report` object — see `types.ts`. Top-level keys:

  ```json
  {
    "id": "…",
    "dataAsOf": "Aug 2026",
    "candidateFirstName": "Daniel",
    "companyName": "Aurelia Robotics",
    "originCity": "San Francisco",
    "officeName": "The Ion / Midtown",
    "mode": "offer",
    "tenure": "rent",
    "weights": { "afford": 8, "commute": 7, "flood": 6, "amen": 5, "fit": 7, "food": 8, "air": 6, "health": 7 },
    "hero": { "headline": "…", "headlineEmphasis": "…", "intro": "…", "facts": [{ "label": "Role", "value": "Senior ML Engineer" }], "careerTitle": "…", "careerText": "…", "howToReadTitle": "…", "howToReadText": "…" },
    "financial": { "summary": "…", "assumptions": "…", "rows": [], "propertyTaxNote": "…" },
    "neighborhoods": [],
    "lifestyle": [],
    "considerations": [],
    "sources": ["City of Houston Open Data", "U.S. Census ACS 5-year"],
    "disclaimer": "…"
  }
  ```

- A `financial.rows[]` entry:

  ```json
  {
    "label": "Estimated take-home pay",
    "origin": "≈ $138,000",
    "houston": "≈ $141,000",
    "originWidth": 98,
    "houstonWidth": 100,
    "delta": "≈ +$3,000 / yr in Houston",
    "direction": "good",
    "note": "Texas has no state income tax; California withholds roughly 9% at this level.",
    "source": "2026 federal and CA brackets, single filer, standard deduction"
  }
  ```

  `origin`/`houston` are pre-formatted display strings — the frontend does no currency or
  rounding logic, so the backend controls precision. `originWidth`/`houstonWidth` are
  0–100 bar widths relative to each other within the row. `direction` is `good` /
  `caution` / `bad` and only picks the delta's colour.

- A `neighborhoods[]` entry: `id`, `name`, `score` (0–100, relative to the other returned
  areas only), `commute`, `commuteMode`, `afford`, `affordLevel` (`good`/`mid`/`low`),
  `rent`, `flood` (`Clear`/`Caution`/`Avoid`), `services`, `momentum`, `why` (prose),
  `safety`, `x`, `y` (CSS percentages for the abstract map), and `factors[]` of
  `{ label, weight (0–100), note }`.

  `safety` is one of `"lower than"`, `"typical of"`, `"higher than"` — a tier, never a
  number and never a rank. The page renders it into a sentence about the city median per
  1,000 residents. HPD advises against raw comparison between areas, so the API should
  not expose a comparable figure even if one is computed internally.

- Errors: `404` unknown or expired ID.

## `POST /reports`

- Status: proposed
- Purpose: build and store a report. Backed by the scoring engine.
- Authentication: recruiter session. To confirm.
- Request:

  ```json
  {
    "profile": { "role": "…", "city": "…", "salary": "…", "offer": "…", "office": "…", "grocery": "…", "food": "…", "hobbies": "…", "sports": "…", "workout": "…", "airport": "…", "health": "…" },
    "office": "ion",
    "mode": "offer",
    "tenure": "rent",
    "weights": { "afford": 8, "commute": 7, "flood": 6, "amen": 5, "fit": 7, "food": 8, "air": 6, "health": 7 }
  }
  ```

  `office` is one of `ion` / `downtown` / `energy` / `tmc` / `nasa`. `mode` is `offer` or
  `remote`; in remote mode the offer equals the current salary. Weights are 0–10 each and
  are normalised server-side.

- Success: `201` with `{ "id": "…", "url": "…" }`.
- Errors: `400` on a malformed profile, `422` if no neighborhood survives the filters.

## `POST /reports/:id/expert-lead`

- Status: proposed
- Purpose: the candidate's opt-in to be introduced to a relocation expert.
- Authentication: none; the report ID is the capability.
- Request: `{ "email": "…", "consent": true }`
- Success: `202`, empty body.
- Errors: `400` if `consent` is not exactly `true`. **Nothing is sent onward without it** —
  the frontend blocks submission, and the backend must not treat that as sufficient.

## `GET /reports`

- Status: proposed
- Purpose: the recruiter dashboard list.
- Success: `200` with `{ "kpis": [], "reports": [] }`. A report summary is
  `{ id, name, origin, role, status, date }` where status is `Viewed` / `Shared` /
  `Draft` / `Expert opt-in`.

## Transcript import and extraction

- Status: **proposed, and the largest open question.**

The create-report flow imports a recruiter call from a meeting-notes tool (Granola,
Fireflies, Fathom, Zoom Notes) and extracts a candidate profile, field by field, each with
a `High` / `Medium` / `Low` confidence the recruiter can check before generating.

The frontend currently fakes both steps. Before it can be built for real we need to agree:
who holds the connector OAuth tokens, whether extraction is a backend endpoint or happens
in the MCP layer, and what the confidence value actually measures.

---

## Endpoint template

Copy this section for each new endpoint and replace the placeholders:

- Status: proposed / agreed / implemented
- Purpose:
- Method and path:
- Authentication:
- Request example:
- Success status and response example:
- Error statuses and response examples:
