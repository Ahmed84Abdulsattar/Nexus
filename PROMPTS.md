# Nexus: Claude Code setup and prompts

## 1. Setup
Follow `GETTING-STARTED.md`. It covers tools, the VS Code extension, the repo, sign-in and checking the agents.

## 2. How to work
- **Order for every task:** architect plans, then a builder agent builds, then qa tests, then security-reviewer checks (for auth, access, secrets or infra), then you review and merge.
- **One backlog task per conversation** (a new tab in the Claude panel). Review the diff before the next task.
- Use **`/plan`** (or Plan mode) before big tasks, so Claude shows its plan first.
- To make sure a specific agent is used, write `@agent-<name>`, for example `@agent-architect`.
- You and your colleague work on **your own machines and branches**. Use worktrees only if one person runs two sessions at once (GETTING-STARTED, Step 9).
- When an agent gets something wrong that could happen again, add one line to `CLAUDE.md` or the relevant doc.

---

## 3. Prompts, in order

### Prompt A: architecture check (once, before any code)
```
Use the architect agent. Read CLAUDE.md, every file in docs/ and db/schema.sql. Do not change the architecture.
Review it as a critic for: <500 users now and 5,000 later, 500 sites / 20,000 assets, DATOMS limits, a 2-person team, and the future plan.
List concerns ranked by impact, each with a suggested change and its trade-off. List contradictions between docs.
Write any open questions for Innovo or DATOMS to docs/open-questions.md.
```
Read the result and decide what to accept. Update the docs for anything you change.

### Prompt B: sprint plan (start of every sprint)
```
Use the architect agent. Plan sprint S0 from docs/source/backlog.md and docs/02-requirements-phase1.md.
Write docs/sprints/S0.md: backlog ID | task | agent | files touched | depends on | acceptance check | requirement IDs.
Only DATOMS, Entra ID and ArcGIS work. List everything else as later.
```
Change `S0` for each sprint.

### Prompt 1: repo skeleton (S0-01, S0-05)
```
Use the devops agent. Create the monorepo exactly as docs/05-file-structure.md and docs/04-tech-stack.md:
pnpm + Turborepo; apps/web (React 19 + Vite + TS + Tailwind), apps/api (NestJS 11 + Fastify), apps/worker (NestJS standalone);
packages/shared, packages/datoms-client, packages/connectors/core, packages/connectors/datoms, packages/config, packages/testing.
Strict TS, ESLint flat config (including a rule blocking @arcgis imports outside apps/web/src/components/map/arcgis), Prettier, Vitest,
Husky + lint-staged + commitlint, docker-compose with PostgreSQL 16, .env.example with every variable in docs/04-tech-stack.md (Environment variables), no values,
.github/workflows/ci.yml (lint, typecheck, test, build). Make pnpm dev/lint/typecheck/test/build work, and show the tree.
```

### Prompt 2: database (S1-01)
```
Use the database agent. Turn db/schema.sql into db/migrations/0001_init.sql (up + down) using node-pg-migrate.
Add `pnpm db:migrate`, `pnpm db:check` (apply migrations to an empty DB and diff against schema.sql) and `pnpm db:seed`.
Write db/seeds/dev-roles.sql and db/seeds/scale-100-sites.ts (100 sites, 5,000 assets, 7 days of 1-minute packets
with ~100 numeric parameters, from fixtures). Run the rollup functions on the seed. Report table sizes and the
timings of the queries in docs/06-database.md section 5. Generate Kysely types into apps/api/src/common/db.
```

### Prompt 3: DATOMS client and API testing (S2-02)
```
Use the datoms-integration agent. Build packages/datoms-client exactly as docs/07-datoms-integration.md section 4
(paging, budget tracker with all windows and the monthly allowance, adaptive interval, 422 halving with the resume formula,
429 Retry-After, backoff, timeouts, X-RateLimit-Unit handling, logging without the token, mapping to Source* types).
Implement packages/connectors/datoms (SourceConnector). Add CLI scripts: check, assets, latest <id>, bulk, poll --minutes N, record.
Fixtures by default; live only with DATOMS_LIVE=true. Full unit tests with fixtures.
```
Then run the scripts yourself with your token to test the real API and record real fixtures.

### Prompt 4: worker (S3-01 – S3-04, S4-01)
```
Use the datoms-integration agent. Build apps/worker as docs/07 section 5 and docs/06 section 4:
leader lock; catalogue-sync (hourly, auto-link, retire, link_todo); live-poll (60 s adaptive, change detection,
packets/latest/status/location, publish to Web PubSub per project with the docs/10 message format);
rollups (every minute); maintenance (daily partitions and retention); sync_run and api_call records; OpenTelemetry metrics.
Integration test with Testcontainers. Replay test at 5,000 assets showing poll + writes under 30 s.
```

### Prompt 5: auth and access (S0-04, S1-02, S2-06)
```
Use the backend-api agent. Implement docs/08-auth-and-access.md in apps/api: EntraJwtGuard (jose), app_user upsert,
AccessContext (cached 5 min, Graph group overage), @RequirePermission with a test that fails if any handler lacks it,
ProjectScopeGuard (404 when out of scope), withProjectScope() for repositories, /v1/me, /v1/config, audit logging,
and the admin endpoints for group-roles and project-access. Integration tests for every role.
```
Then: `Use the security-reviewer agent to review this branch.`

### Prompt 6: API endpoints (S2-01, S4-03, S5-01–03, S6-01–04, S7-01)
```
Use the backend-api agent. Implement the endpoints in docs/10-api-design.md for <module>
(e.g. portfolio | assets + telemetry | equipment | energy | events | explorer | integrations).
Data as stored, ts on every live value, history table chosen by range, OpenAPI updated,
an out-of-scope test for every endpoint.
```

### Prompt 7: frontend shell (S0-06, S0-08, S1-05 – S1-08)
```
Use the frontend agent. Build the app shell from docs/05 and docs/11: MSAL sign-in, providers, router with all routes,
AppShell (header, search, notification bell, user menu), role-filtered navigation, design tokens incl. state/status colours,
responsive layouts for phone/tablet/desktop, and the loading/empty/error/stale/coming-later states.
Generate the API client from apps/api/openapi.json and add MSW mocks.
```

### Prompt 8: ArcGIS map (replaces S0-09; then S2-03, S4-05)
```
Use the frontend agent. Implement docs/09-map-arcgis.md: components/map/types.ts, MapView.tsx, and the arcgis/ adapter
(lazy-loaded @arcgis/core, API key from /v1/config, MapView for 2D/satellite and SceneView for 3D, client-side FeatureLayer,
UniqueValueRenderer from tokens, clustering, asset-type icons, pulse on change, applyEdits for live updates, destroy on unmount).
Then build the portfolio map (S2-03), the project list and filters (S2-04/05), and the project site map with the mode switch (S4-04/05).
```

### Prompt 9: project page, equipment, energy, notifications, explorer, admin (S4 – S7)
```
Use the frontend agent. Build <screen> from docs/02 (R-xx) and docs/source/Nexus_Structure.xlsx, following docs/11.
Use the generated API client and TanStack Query hooks; live updates via LiveProvider; generic parameter rendering.
```

### Prompt 10: infrastructure (S0-02, S0-03, S0-07, S7-05)
```
Use the devops agent. Write infra/ Bicep for dev/test/prod per docs/04 and docs/12 section 5, the deploy workflows
(dev on merge, prod on approval, migrations before rollout), dashboards and alerts listed in your instructions, and runbooks.
```

### Prompt 11: test and review (after every task)
```
Use the qa agent to check task <ID> against docs/sprints/<S#>.md and the docs/14 checklist; run all tests.
Then use the security-reviewer agent on this branch if it touches auth, access, live push, secrets, infra or export.
List what must be fixed before merge.
```

### Prompt 12: scale check (S5-04, S8-01)
```
Use the qa agent. Build and run the load tests in docs/12 section 3 (1,000 API users; worker at 100/5,000 and 500/20,000
with fixture replay; 1,000 live clients). Prove DATOMS calls per minute stay flat as users grow.
Report p95s, poll duration, DB load, the first bottleneck and which docs/12 trigger it hits.
```
