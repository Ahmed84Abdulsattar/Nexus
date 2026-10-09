# 05 · File structure

Put new code where this file says. If something has no place yet, ask the architect agent. Do not invent a new top-level folder.

```
nexus/
├── CLAUDE.md                         # rules for every agent (short); points to docs/
├── README.md                         # how to run locally
├── package.json                      # root scripts: dev, build, lint, test, typecheck, db:*
├── pnpm-workspace.yaml               # apps/*, packages/*
├── turbo.json
├── tsconfig.base.json                # strict TS settings shared by all packages
├── eslint.config.js
├── .prettierrc
├── .editorconfig
├── .nvmrc                            # Node 22
├── .env.example                      # every env var, no real values
├── docker-compose.yml                # local PostgreSQL 16 (+ Azurite / Web PubSub emulator later)
├── GETTING-STARTED.md                # VS Code + Claude Code setup and first steps
├── PROMPTS.md                        # prompts for each step of the build
├── .gitignore
├── .dockerignore                     # keeps .env, node_modules and tests out of images
├── .husky/                           # git hooks: lint-staged (pre-commit), commitlint (commit-msg)
├── commitlint.config.js              # Conventional Commits
├── renovate.json                     # dependency update rules (Renovate)
├── .claude/
│   ├── settings.json                 # shared Claude Code permissions (allows pnpm checks, blocks .env reads)
│   └── agents/                       # role agents (architect, datoms-integration, …)
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                    # lint, typecheck, test, build, contract tests on every PR
│   │   ├── deploy-dev.yml            # on merge to main
│   │   └── deploy-prod.yml           # manual approval (no test environment, ADR 0008)
│   ├── pull_request_template.md
│   └── CODEOWNERS                    # apps/web → frontend dev; apps/api, apps/worker, db → backend dev
│
├── docs/
│   ├── 01-product-vision.md … 14-testing-quality.md
│   ├── adr/                          # NNNN-title.md decision records
│   ├── sprints/                      # S0.md, S1.md … (task breakdowns by the architect agent)
│   ├── runbooks/                     # on-call: DATOMS down, poll lag, DB full, key rotation;
│   │                                 # setup: entra-setup.md, ArcGIS key, Azure deploy (no secret values)
│   └── source/                       # client docs, DATOMS PDF, sprint sheet (read-only inputs) + markdown copies:
│                                     # brief.md, structure.md, backlog.md (agents read these)
│
├── db/
│   ├── schema.sql                    # reference schema: the target state, kept in sync with migrations
│   ├── roles.sql                     # database roles and grants (run once per environment by the migrator)
│   ├── migrations/                   # 0001_init.sql, 0002_….sql (node-pg-migrate, SQL, up + down)
│   ├── seeds/
│   │   ├── dev-roles.sql             # roles, permissions, demo group mappings
│   │   ├── dev-settings.sql          # dev only: poll.subset_external_ids, small budget.max_share (ADR 0005)
│   │   └── scale-100-sites.ts        # generates 100 sites / 5,000 assets from fixtures
│   └── README.md
│
├── apps/
│   ├── web/                          # React SPA (frontend developer owns this)
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── public/                   # static files, incl. staticwebapp.config.json (SPA fallback, headers)
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── app/
│   │       │   ├── App.tsx
│   │       │   ├── router.tsx        # all routes (see table below)
│   │       │   ├── providers.tsx     # MSAL, QueryClient, Theme, LiveProvider
│   │       │   └── layout/           # AppShell, Header, SideNav, UserMenu, NotificationBell
│   │       ├── auth/                 # msal config, RequireAuth, usePermissions, Can component
│   │       ├── api/
│   │       │   ├── client.ts         # openapi-fetch instance + auth header + error mapping
│   │       │   ├── schema.d.ts       # GENERATED from apps/api openapi.json (do not edit)
│   │       │   └── queries/          # TanStack Query hooks per resource (useProjects, useAsset…)
│   │       ├── live/                 # Web PubSub client, LiveProvider, useLiveProject
│   │       ├── components/
│   │       │   ├── ui/               # Button, Card, Badge, Table, Tabs, Dialog… (Radix + Tailwind)
│   │       │   ├── map/              # provider-neutral map wrapper (pages import only from here)
│   │       │   │   ├── MapView.tsx           # the wrapper used by pages
│   │       │   │   ├── types.ts              # MapMarker, MapLayerSpec, MapMode (2d|satellite|3d)
│   │       │   │   ├── arcgis/               # the ONLY place @arcgis/* is imported: view setup, layers, renderers, clustering
│   │       │   │   └── legend/
│   │       │   ├── charts/           # TrendChart, Timeline, Gauge (ECharts wrappers)
│   │       │   ├── data/             # ParameterList, ValueWithUnit, StatusBadge, StaleIndicator
│   │       │   └── feedback/         # Loading, Empty, Error, ComingSoon
│   │       ├── features/             # one folder per screen area; each has components/, hooks/, routes
│   │       │   ├── portfolio/        # top-level map, project list, summary tiles, filters
│   │       │   ├── project/          # project page: site map, info boxes, asset side panel
│   │       │   ├── equipment/        # equipment detail table, device card
│   │       │   ├── energy/           # energy ribbon, table, charts
│   │       │   ├── events/           # notifications list
│   │       │   ├── explorer/         # data explorer
│   │       │   ├── admin/            # users and roles, project access, integration health, linking to-do
│   │       │   └── dev/              # components page (dev builds only, S0-06); never in the production bundle
│   │       ├── assets/icons/asset-types/  # tower-crane.svg, hoist.svg, generator.svg, generic.svg …
│   │       ├── styles/               # tailwind.css, tokens.css (colours incl. status/state colours)
│   │       ├── lib/                  # format (numbers, units, dates in Asia/Dubai), featureFlags
│   │       └── test/                 # MSW handlers, test utils
│   │   └── e2e/                      # Playwright specs
│   │
│   ├── api/                          # NestJS REST API (backend developer owns this)
│   │   ├── src/
│   │   │   ├── main.ts               # Fastify adapter, helmet, CORS, swagger, pino
│   │   │   ├── app.module.ts
│   │   │   ├── config/               # zod env schema, Key Vault loader
│   │   │   ├── common/
│   │   │   │   ├── auth/             # entra-jwt.guard.ts, access-context.service.ts (AccessContext + cache),
│   │   │   │   │                     # decorators.ts (@RequirePermission, @AnySignedIn, @Public), project-scope.guard.ts,
│   │   │   │   │                     # project-scope.ts (withProjectScope for Kysely queries)
│   │   │   │   ├── db/               # Kysely provider, transaction helper, generated DB types
│   │   │   │   ├── errors/           # problem+json filter
│   │   │   │   ├── paging/           # cursor paging helpers
│   │   │   │   └── logging/
│   │   │   └── modules/
│   │   │       ├── access/           # me, users, roles, group mappings, project access
│   │   │       ├── audit/
│   │   │       ├── portfolio/        # projects, districts, summary tiles
│   │   │       ├── spatial/          # buildings, levels, zones
│   │   │       ├── assets/           # assets, asset types
│   │   │       ├── telemetry/        # latest, history (rollups), parameters
│   │   │       ├── equipment/        # equipment list + counts (views over assets/telemetry)
│   │   │       ├── energy/           # energy summary, table, trends
│   │   │       ├── events/           # alerts/notifications + read state
│   │   │       ├── explorer/         # any asset/parameter/range + CSV export
│   │   │       ├── integrations/     # health, sync runs, linking to-do
│   │   │       ├── live/             # Web PubSub client token
│   │   │       ├── config/           # /v1/config: feature flags, ArcGIS settings, enums
│   │   │       ├── admin/            # /v1/admin/projects, settings, feature flags (combines other modules' services)
│   │   │       └── health/           # /health/live, /health/ready
│   │   │       # each module: <name>.module.ts, <name>.controller.ts, <name>.service.ts,
│   │   │       #              <name>.repository.ts (Kysely), dto/, <name>.spec.ts
│   │   ├── test/                     # integration tests (Testcontainers Postgres)
│   │   ├── openapi.json              # GENERATED on build
│   │   └── Dockerfile                # image for Container Apps (non-root)
│   │
│   └── worker/                       # NestJS standalone: the ONLY process that calls DATOMS
│       ├── Dockerfile                # image for Container Apps (non-root, exactly 1 replica)
│       └── src/
│           ├── main.ts
│           ├── worker.module.ts
│           ├── leader/               # pg advisory-lock leader election
│           ├── jobs/
│           │   ├── catalogue-sync.job.ts   # hourly (+ early on unknown ids): assets, nameplate; safe retire
│           │   ├── live-poll.job.ts        # 60 s default, per asset type: BULK endpoint only (ADR 0010) →
│           │   │                           #   packets, latest, status, location, alerts (no separate events job)
│           │   ├── rollups.job.ts          # SQL once per CLOSED 5-min bucket (+2 poll intervals), then 1h, 1d (ADR 0007)
│           │   └── maintenance.job.ts      # daily: create future partitions, drop old ones (archive deferred, ADR 0008)
│           │   # history-backfill: ON HOLD until a DATOMS history feed is decided by ADR (ADR 0010)
│           ├── pipeline/             # map SourceReading → DB writes, change detection, publish
│           ├── publish/              # Web PubSub publisher (group per project)
│           └── metrics/              # sync_run writer, OpenTelemetry metrics
│
├── packages/
│   ├── shared/                       # used by web, api, worker
│   │   └── src/
│   │       ├── types/                # Project, Asset, Reading, Event, Status, Permission …
│   │       ├── schemas/              # zod schemas (DTOs) shared by API and web
│   │       ├── permissions.ts        # permission keys (single source of truth)
│   │       └── constants.ts          # project states, status display names (labels only, from data)
│   ├── datoms-client/                # ALL DATOMS knowledge lives here
│   │   ├── src/
│   │   │   ├── client.ts             # DatomsClient: listAssets, queryLatestBulk (fleet + id mode); getLatest = CLI only
│   │   │   ├── http.ts               # fetch + gzip + retry/backoff + Retry-After
│   │   │   ├── budget.ts             # rate + credit budget tracker × budget.max_share (07 section 4, ADR 0005)
│   │   │   ├── paging.ts             # page walker, 422 halving, learned page size
│   │   │   ├── mapping.ts            # THE ONLY place DATOMS field names live: DATOMS JSON → Source* types
│   │   │   │                         # (values, status, location, asset type, site link, kind, alerts). When
│   │   │   │                         # the DATOMS sample (Q21) arrives, only this file + its tests change.
│   │   │   ├── errors.ts
│   │   │   └── types.ts              # raw DATOMS response types (private to this package)
│   │   ├── fixtures/                 # recorded real responses (tokens/headers removed), incl. the DATOMS sample bulk response (Q21)
│   │   ├── scripts/                  # CLI: check, assets, latest (data/latest: CLI only), bulk, poll --minutes N, record
│   │   │                             # live runs use id mode by default; fleet mode needs --fleet (ADR 0005)
│   │   └── test/
│   ├── connectors/
│   │   ├── core/                     # SourceConnector interface + Source* types
│   │   └── datoms/                   # DatomsConnector implements SourceConnector using datoms-client
│   ├── config/                       # shared eslint/tsconfig/vitest presets
│   └── testing/                      # fixture loaders, fake connector, data generators
│
├── infra/                            # Bicep
│   ├── main.bicep
│   ├── modules/                      # containerApps, postgres, keyVault, webPubSub, staticWebApp,
│   │                                 # appInsights, acr, network, storage, frontDoor
│   └── env/                          # dev.bicepparam, prod.bicepparam (two cloud environments, ADR 0008)
│
└── tests/
    ├── load/                         # k6 scripts: api-1000-users.js, worker-5000-assets
    └── contract/                     # DATOMS contract checks (run against live API in CI on schedule)
```

## Frontend routes
| Route | Screen | Requirement |
|---|---|---|
| `/` | Portfolio map | R-10–R-13 |
| `/projects/:projectId` | Project page (site map + info boxes) | R-20–R-27 |
| `/projects/:projectId/assets/:assetId` | Asset/device card (also opens as a side panel) | R-23, R-33 |
| `/projects/:projectId/equipment` | Equipment detail | R-30 |
| `/projects/:projectId/energy` | Energy detail | R-31, R-32 |
| `/notifications` | Notifications | R-40, R-41 |
| `/explorer` | Data explorer | R-50 |
| `/admin/users` · `/admin/access` · `/admin/integrations` · `/admin/linking` | Admin | R-60–R-62 |
| reserved: `/projects/:id/manpower`, `/materials`, `/gallery`, `/bim` | Future | 13-roadmap |

## Naming
- Files `kebab-case.ts`; React components `PascalCase.tsx`; hooks `useThing.ts`.
- DB: `snake_case`, plural table names are **not** used (singular: `asset`, `project`).
- API paths: `/v1/<plural-resource>`; JSON fields `camelCase`.
- Permission keys: `area.action` (e.g. `project.read`, `admin.users.manage`).
- Branches: `S2-03-portfolio-map`; PR title starts with the backlog ID.

## Ownership
| Path | Owner | Agent |
|---|---|---|
| `apps/web/**` | Frontend developer | frontend |
| `apps/api/**` | Backend developer | backend-api |
| `apps/worker/**`, `packages/datoms-client/**`, `packages/connectors/**` | Backend developer | datoms-integration |
| `db/**` | Backend developer | database |
| `infra/**`, `.github/**` | Backend developer (until DevOps hire) | devops |
| `packages/shared/**` | Both (PR needs both reviews) | any, with architect review |
| `docs/**` | Both | architect |
