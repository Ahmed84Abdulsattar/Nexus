# 14 · Testing and quality

## Definition of done (every task / PR)
1. The acceptance check from the backlog row or requirement is met and shown in the PR (screenshot, test or query output).
2. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass.
3. New code has tests (see the pyramid below). Coverage of changed lines is ≥ 80% for backend logic.
4. A security-sensitive change (auth, access, secrets, infra, DATOMS credentials) was reviewed by the **security-reviewer** agent and a human.
5. Docs are updated if behaviour, API, schema or structure changed (`docs/`, `db/schema.sql`, OpenAPI).
6. There is no `TODO` without a backlog ID.

## Tooling decisions
- **Node version.** CI runs Node 22 LTS (from `.nvmrc`); that result is the one that counts. Developers may run a newer Node locally (e.g. 24); `engines` is `>=22`. If something passes locally but fails in CI, CI wins.
- **Commit messages.** commitlint uses `@commitlint/config-conventional` with the `subject-case` rule turned off, because subjects start with a backlog ID (e.g. `feat: S2-03 portfolio map`). All other Conventional Commits rules apply. Config: `commitlint.config.js`.

## Test pyramid
| Level | Tool | What |
|---|---|---|
| Unit | Vitest | datoms-client (paging, 422 halving, 429 Retry-After, budget windows, mapping), access logic, formatting, map marker mapping |
| Integration | Vitest + Testcontainers (Postgres 16) + supertest | Every API endpoint, including a **403/404 out-of-scope test for every endpoint**; live subscriptions refuse out-of-scope projects and connections are closed on revocation; worker pipeline writing fixtures to the DB; closed-bucket rollups and late packets; safe catalogue retire; partition maintenance |
| Contract | zod schemas vs live DATOMS (nightly, read-only) and vs fixtures (every PR) | DATOMS response shapes |
| API contract | CI regenerates `apps/api/openapi.json` and `apps/web/src/api/schema.d.ts` (`pnpm openapi:generate`) and fails on `git diff --exit-code`; web `typecheck` fails when a call site no longer matches | Frontend and backend agree (S1-03) |
| Component | Vitest + Testing Library + MSW | Info boxes, tables, side panel, states (loading, empty, error, stale) |
| End-to-end | Playwright (desktop + phone viewports) | Sign in (test tenant or mocked MSAL), portfolio → project → asset, equipment table, energy page, notifications, admin access change |
| Load | k6 + fixture replay | See `12-scalability.md`; scripts and how to run: `tests/load/README.md`. Record each run in the results table in `12-scalability.md` section 3. |
| Security | `pnpm audit`, Renovate, OWASP ZAP baseline in CI on dev, penetration test before go-live | |

## Database integration tests (S1-01)
- They need a PostgreSQL 16 server and the variable `TEST_DATABASE_ADMIN_URL`, an administrator login on any database of a throw-away server (docs/04). Each test file creates its own database (`@nexus/db/testing`, `createTestDatabase()`), runs the real migrations, and drops it at the end, so files run in parallel and never touch your data.
- **Locally:** start Postgres (`docker compose up -d` or `scripts/pg-local.ps1 start`), then `TEST_DATABASE_ADMIN_URL=postgres://nexus@localhost:5432/postgres pnpm test`. Without the variable the database tests are skipped with a warning.
- **In CI:** `.github/workflows/ci.yml` starts a `postgres:16` service and sets the variable. When `CI` is set and the variable is missing, `@nexus/db/testing` throws, so these tests can never skip silently in CI. `turbo.json` passes both variables through to `pnpm test`. CI also runs `pnpm db:check` (needs `pg_dump`).
- Role behaviour is tested by connecting as the administrator and running `SET ROLE nexus_api` (or `nexus_worker`), so a missing grant fails exactly as it would in Azure.

## Fixtures and fake data
- `packages/datoms-client/fixtures/` holds real recorded responses, cleaned of tokens and headers.
- `packages/testing` has generators to scale fixtures to N sites / M assets with realistic timing (1 packet per minute, some offline, some status changes).
- Never use production data in tests.

## Code review checklist
- [ ] Nothing outside `datoms-client` / `connectors/datoms` knows DATOMS details. DATOMS field names appear only in `packages/datoms-client/src/mapping.ts`.
- [ ] Telemetry comes only from the bulk endpoint; `data/latest` only in CLI scripts (ADR 0010).
- [ ] Equipment lists, counts, map layers and views filter `kind = 'physical'` (ADR 0009).
- [ ] Parameter names and units are looked up per `(source_system, source_type_name, key)`, never by key alone (ADR 0011).
- [ ] Live push messages carry no parameter values, and nothing project-specific goes to `portfolio` (ADR 0008).
- [ ] No per-poll writes beyond packets, latest values and real changes (`06` §4).
- [ ] No hard-coded sites, asset types, parameters or statuses.
- [ ] Every endpoint has `@RequirePermission`, and project data goes through `withProjectScope`.
- [ ] No status, threshold or alert invented by Nexus.
- [ ] Time handled as UTC in storage, Asia/Dubai in display.
- [ ] Queries on partitioned tables have a time filter.
- [ ] No secrets in code, logs or fixtures.
- [ ] Mobile layout checked.
