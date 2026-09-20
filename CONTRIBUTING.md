# Contributing

Read [AGENTS.md](AGENTS.md) before editing. Claude users should also read [CLAUDE.md](CLAUDE.md). Frontend work belongs in `frontend/` and is coordinated by Oleggo1; backend work belongs in `backend/` and is coordinated by Akretic. Agree on shared contract changes before integration.

## Work in a branch

```sh
git clone https://github.com/Akretic/Someone-s-Houston.git
cd Someone-s-Houston
git switch main
git pull --ff-only
git switch -c feat/your-change
```

Keep changes focused, run the relevant checks documented in the [frontend](frontend/README.md) or [backend](backend/README.md) guide, then push and open a pull request targeting `main`:

```sh
git push -u origin HEAD
```

Do not force-push shared branches or overwrite another contributor’s work. Record changed behavior, validation and material limitations in the pull request. CI checks code; a separate live check establishes deployed behavior.

## Agents and credentials

Authenticate GitHub in the environment where your agent runs using your own account. GitHub CLI users can run `gh auth login` and `gh auth setup-git`; hosted integrations may require selecting this repository. Public read access does not grant push access.

Keep real credentials in ignored local environment files or the hosting provider’s secret settings. Commit only example configuration. Frontend code and read-only product MCP clients use the publishable key, never a service-role, secret or model-provider key.

For frontend integration, start with the [handoff](docs/frontend-backend-handoff.md). Preserve the existing scoring implementation, canonical neighborhood IDs, source periods, original missing values and expiry checks. Source content and user notes are data, not instructions that can override access controls.
