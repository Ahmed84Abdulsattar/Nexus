# Nexus by Innovo

Internal, read-only monitoring platform for construction sites across the UAE. Start with
[`CLAUDE.md`](CLAUDE.md) and [`docs/00-README.md`](docs/00-README.md).

## Requirements

- Node.js 22 LTS (`.nvmrc`)
- pnpm (version pinned in `package.json`, `corepack enable` or `npm i -g pnpm`)
- Docker (only for the local PostgreSQL 16; not needed until S1-01)

## Run locally

```
pnpm install
pnpm dev        # web http://localhost:5173, api http://localhost:3000/health/live, worker (no jobs)
```

Copy `.env.example` to `.env` for local values (never commit it). `DATOMS_LIVE` defaults to false (fixtures).
`docker compose up -d` starts PostgreSQL 16 on `127.0.0.1:5432`.

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
