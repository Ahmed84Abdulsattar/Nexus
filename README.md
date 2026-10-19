# Nexus by Innovo

Internal, read-only monitoring platform for construction sites across the UAE. Start with
[`CLAUDE.md`](CLAUDE.md) and [`docs/00-README.md`](docs/00-README.md).

## Requirements

- Node.js 22 LTS (`.nvmrc`)
- pnpm (version pinned in `package.json`, `corepack enable` or `npm i -g pnpm`)
- A local PostgreSQL 16: Docker (`docker compose up -d`) or, on Windows without Docker, `scripts/pg-local.ps1`
- For `pnpm db:check`: the PostgreSQL 16 client tools (`pg_dump`)

## Run locally

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
