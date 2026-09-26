# Working agreements

- Support was discontinued on September 26, 2026. Keep this repository public as a historical reference. Do not restart scheduled workflows, source imports, refresh Cron or update monitoring without a new explicit owner request. See `docs/data-operations.md` for retirement status; its older operating instructions are historical.

- Frontend work belongs in `frontend/`, owned by Oleggo1.
- For frontend/backend integration, start with `docs/frontend-backend-handoff.md`; reuse the current frontend data/auth layers and verify with the documented preflight before declaring it connected.
- Backend work belongs in `backend/`, owned by Akretic-Sean.
- `docs/api.md` is the shared API contract. Keep endpoint paths, request/response examples, authentication, and errors in sync with implementation. Mark proposals clearly until both sides agree.
- For source imports, data reads, MCP tools or report integration, follow `docs/data-instructions.md` for shared data meanings, freshness and missing-value rules. `docs/claude-data-guide.md` covers partner connection and interpretation checks.
- Use short-lived feature branches and pull requests targeting `main`. Pull the latest `main` before starting a new feature.
- Keep edits focused on your area. Coordinate changes to shared configuration and the other owner's files.
- Document the chosen stack and exact setup, development, and test commands in the relevant README. Use one lockfile per package or agreed workspace, and avoid unrelated dependency changes.
- Run the relevant checks once the application has them and report what you verified in the pull request.
- Never commit secrets, real `.env` files, private keys, or credentials. Use `.env.example` with placeholders.
- Do not force-push shared branches or overwrite another person's uncommitted work.
