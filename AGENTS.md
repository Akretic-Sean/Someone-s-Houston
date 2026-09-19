# Working agreements

- Frontend work belongs in `frontend/`, owned by Oleggo1.
- Backend work belongs in `backend/`, owned by Akretic-Sean.
- `docs/api.md` is the shared API contract. Keep endpoint paths, request/response examples, authentication, and errors in sync with implementation. Mark proposals clearly until both sides agree.
- Use short-lived feature branches and pull requests targeting `main`. Pull the latest `main` before starting a new feature.
- Keep edits focused on your area. Coordinate changes to shared configuration and the other owner's files.
- Document the chosen stack and exact setup, development, and test commands in the relevant README. Use one lockfile per package or agreed workspace, and avoid unrelated dependency changes.
- Run the relevant checks once the application has them and report what you verified in the pull request.
- Never commit secrets, real `.env` files, private keys, or credentials. Use `.env.example` with placeholders.
- Do not force-push shared branches or overwrite another person's uncommitted work.
