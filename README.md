# Hou Match

Shared public repository for our hackathon website.

| Area | Owner | Folder |
| --- | --- | --- |
| Frontend | @Oleggo1 | `frontend/` |
| Backend | @Akretic-Sean | `backend/` |
| API contract | Both | `docs/api.md` |

## Start working

1. Oleggo1's collaborator invitation is accepted; use your own GitHub account.
2. Clone the repository in the environment where your coding agent runs:

   ```sh
   git clone https://github.com/Akretic-Sean/Someone-s-Houston.git
   cd Someone-s-Houston
   ```

3. Read `AGENTS.md`. Claude users should also read `CLAUDE.md`.
4. Create a branch for your work:

   ```sh
   # Frontend
   git switch -c feat/frontend-initial
   # Or backend
   git switch -c feat/backend-initial
   ```

5. Build inside your folder. Record agreed endpoints and example payloads in `docs/api.md` before connecting the frontend to the backend.
6. Commit your changes, push your branch, and open a pull request into `main`:

   ```sh
   git push -u origin HEAD
   ```

Before starting the next feature, switch to `main`, run `git pull --ff-only`, and create a new feature branch.

## Agent access

Authenticate GitHub in the environment where the agent runs using your own GitHub account. With GitHub CLI, run `gh auth login` and then `gh auth setup-git`. Hosted agent integrations may also need this repository selected in their GitHub connection settings. The collaborator invitation must be accepted before Oleggo1 can push to this repository.

## Project setup

The first backend layer is live: 88 Houston Super Neighborhood profiles in Supabase, a read-only API and a local Claude MCP connector. Start with [backend setup](backend/README.md), the [API contract](docs/api.md), and [data/cost notes](docs/neighborhood-layer.md). Frontend integration, report generation and hosted MCP deployment remain in progress/planning.

Commit example configuration with placeholder values in `.env.example`. Keep actual API keys and credentials in local environment files or the hosting provider's secret settings.
