# Nexus by Innovo — rules for every Claude Code session and agent

Read `docs/00-README.md` first, then the docs it lists for your role. The docs are the source of truth. This file is the short version.

## What we are building
- **Nexus** is Innovo Group's internal, **read-only** monitoring platform for construction sites across the UAE.
- It has a UAE **portfolio map** (ArcGIS) of all sites, then a **project page** (site map with Satellite / 2D / 3D, live asset icons coloured by status, equipment and energy info boxes), then **detail pages** (equipment table, energy page, trends, device card), plus notifications, a data explorer and admin.
- **Data:** only from the **DATOMS Public API v4** in phase 1. Every site item has its own sensor in DATOMS. **Users:** Innovo employees through **Microsoft Entra ID**. **Map:** **Esri ArcGIS**.
- **Users:** fewer than 500 now. Design target: 5,000 users, 500 sites, 20,000 assets, with no rewrite.
- **Future** (do not build, never block): manpower/HSE, tracked materials, weather, gallery/CCTV/drone, reporting feed, BIM digital twin, AI, more data sources. See `docs/13-roadmap-future.md`.
- **Out of scope:** device control, Nexus-made thresholds/statuses/alerts, reports, Arabic, wall screens, external users.

## Architecture (fixed; changing it needs an ADR in `docs/adr/`)
- TypeScript monorepo (pnpm + Turborepo), modular monolith:
  - `apps/web`: React 19 + Vite SPA, ArcGIS Maps SDK, TanStack Query, Tailwind + Radix, ECharts, MSAL.
  - `apps/api`: NestJS 11 (Fastify), REST `/v1` + OpenAPI, Kysely, zod, Entra JWT (jose).
  - `apps/worker`: NestJS standalone. **The only process that calls DATOMS.** Leader lock, 60 s bulk poll, hourly catalogue, rollups, maintenance.
  - `packages/shared` (types, zod schemas, permission keys), `packages/datoms-client` (all DATOMS knowledge), `packages/connectors/*` (source connector interface).
- **PostgreSQL 16** (Azure Flexible Server; the same SQL runs on-prem). Native partitions and Nexus rollup tables. **No TimescaleDB dependency** (ADR 0003). Reference schema: `db/schema.sql`.
- Azure UAE North: Container Apps (api, worker), Static Web Apps (web), Web PubSub (live push), Key Vault, App Insights, Bicep, GitHub Actions.
- No Kafka, no microservices, no Kubernetes, no GraphQL, no ORM magic (ADRs 0001, 0004).

## Hard rules
1. **Show data as DATOMS reports it.** Never invent statuses, thresholds, alarms or calculated values. Missing data means "—" plus a timestamp, never a guess or a zero.
2. **DATOMS details live only in `packages/datoms-client`.** The API and browser never call DATOMS.
3. **Nothing hard-coded:** no site lists, asset types, parameter names or status labels. Read them from data (`asset_type`, `parameter`, `status_map`).
4. **User count must never change DATOMS call volume.** Screens read Nexus's DB and Web PubSub only.
5. **Respect the DATOMS limits** (`docs/07-datoms-integration.md`): the budget tracker, 422 halving, 429 Retry-After, and never `data/latest` in the poll loop.
6. **Every endpoint has `@RequirePermission` (or `@AnySignedIn` / `@Public` where `docs/10` says so), and every project-data query uses `withProjectScope`.** Default deny. Out-of-scope gives 404.
7. **ArcGIS (`@arcgis/*`) is imported only in `apps/web/src/components/map/arcgis/`.** Pages use `<MapView>` from `components/map/`.
8. **Never delete synced rows.** Set `retired_at`. Keep `source_system` + `external_id` and the building/level/zone links (BIM-ready). `db/migrations/0001_init.sql` is frozen (Ahmed, 2026-10-19): every schema change is a new migration plus the `db/schema.sql` update, and `pnpm db:check` must pass.
9. **Time:** store UTC (`timestamptz`), display Asia/Dubai. Daily rollups use Dubai days.
10. **Secrets** come only from env / Key Vault. Never commit `.env`, tokens or keys, and never paste them into prompts or logs.
11. **Definition of done:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass. The acceptance check is shown. Docs, `db/schema.sql` and OpenAPI are updated in the same PR (`docs/14-testing-quality.md`).
12. **Small PRs**, one backlog task each. The branch and PR title start with the backlog ID (e.g. `S2-03 portfolio map`).
13. **When unsure, stop and ask.** Write open questions to `docs/open-questions.md`; do not guess them into code. Put new things where `docs/05-file-structure.md` says.

## Where things are
- Requirements and backlog: `docs/02-requirements-phase1.md`, `docs/source/backlog.md` (tasks S0-01 … S10-05, a markdown export of `Nexus_Phase1_Sprint_Plan.xlsx`).
- Client inputs (markdown copies are easiest to read): `docs/source/brief.md`, `docs/source/structure.md`, `docs/source/datoms-api-v4.pdf` (originals: `.docx`, `.xlsx`).
- Sprint task breakdowns: `docs/sprints/S#.md` (written by the architect agent).
- Fixtures (recorded DATOMS responses): `packages/datoms-client/fixtures/`.

## Team
- Ahmed: backend (api, worker, datoms-client, db, infra). Colleague: frontend (apps/web).
- More hires are coming (QA, backend, UX, BIM, DevOps, data). Write code and docs so a new person can understand them in a day.
- Agents propose and build; humans review and merge.

## Commands
`pnpm install` · `pnpm dev` · `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build` · `pnpm db:migrate` · `pnpm db:check` · `pnpm db:seed` · `pnpm --filter @nexus/worker dev` (fixtures unless `DATOMS_LIVE=true`)
