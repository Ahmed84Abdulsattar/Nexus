# Nexus by Innovo

Internal, read-only monitoring platform for construction sites across the UAE. Start with
[`CLAUDE.md`](CLAUDE.md) and [`docs/00-README.md`](docs/00-README.md).

## Requirements

- Node.js 22 LTS (`.nvmrc`)
- pnpm (version pinned in `package.json`, `corepack enable` or `npm i -g pnpm`)
- A local PostgreSQL 16: Docker (`docker compose up -d`) or, on Windows without Docker, `scripts/pg-local.ps1`
- For `pnpm db:check`: the PostgreSQL 16 client tools (`pg_dump`)

## Run locally

**One command, no Azure and no Entra** (local sign-in as a demo user, real local API, worker on fixtures):

Command Prompt (`cmd.exe`), from the repository folder:

```
cd C:\path\to\Nexus
pnpm install
powershell -ExecutionPolicy Bypass -File scripts\pg-local.ps1 start
pnpm dev:local
```

(`docker compose up -d` replaces the second command if you use Docker.) Then open http://localhost:5173, open the
user menu (top right) and choose "Sign in as Admin" (or Leadership, Project manager, Site user, Viewer). Ctrl+C stops
everything. `pnpm dev:local` checks PostgreSQL, builds the workspace packages, runs `db:migrate` and `db:seed` (demo group
roles and passwordless local logins), then starts the API (`AUTH_MODE=dev APP_ENV=local`, http://localhost:3000), the worker
(`DATOMS_LIVE=false`, fixtures) and the web app (`VITE_AUTH_MODE=dev VITE_USE_MOCKS=false`). It uses only the passwordless
local database URLs of `docs/04`. The portfolio map lists projects once the API serves them (S2-01 / the catalogue sync); until
then that call returns 404. Local sign-in is described in `docs/08` section 7 and exists in no deployed environment.

Without an API, `pnpm dev` runs the web app on the MSW mocks only.

Manual steps (what `dev:local` does):

```
pnpm install
pnpm db:migrate # create the schema, then the passwordless local login users:
pnpm db:seed
pnpm dev        # web http://localhost:5173, api http://localhost:3000/health/live, worker (no jobs)
```

Copy `.env.example` to `.env` for local values (never commit it). `DATOMS_LIVE` defaults to false (fixtures).
`docker compose up -d` starts PostgreSQL 16 on `127.0.0.1:5432`.

## Database

Three logins, three variables (`docs/04-tech-stack.md`): `DATABASE_ADMIN_URL` for `pnpm db:migrate`,
`db:seed` and `db:check`; `DATABASE_URL` for the API; `WORKER_DATABASE_URL` for the worker. With
`APP_ENV=local` the first and last fall back to `DATABASE_URL`; elsewhere they are required.
Migrations are in `db/migrations`, the target schema in `db/schema.sql`, and everything else (commands,
how to write a migration, the 100-site benchmark) in [`db/README.md`](db/README.md).
Integration tests that need PostgreSQL run when `TEST_DATABASE_ADMIN_URL` is set (CI does) and are
skipped with a warning otherwise.

## Checks (definition of done)

```
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

`pnpm format` rewrites formatting; CI also runs `pnpm format:check`.

## Layout

See [`docs/05-file-structure.md`](docs/05-file-structure.md). Shared tsconfig, ESLint and Vitest presets
are in `packages/config`; the import-boundary lint rules (ArcGIS, DATOMS client, connectors) and their
tests are there too.

## Commits and PRs

Conventional Commits (checked by commitlint). Branch and PR title start with the backlog ID, for
example `S0-01 monorepo skeleton`. Merge with merge commits, not squash.
