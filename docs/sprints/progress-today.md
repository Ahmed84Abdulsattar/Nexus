# Progress log (started 2026-10-12)

Running log kept by the orchestrator session. Nothing here is merged by an agent; Ahmed merges at the end of the day.
Rules followed: never merge; one backlog task per branch; stacked PRs when a task needs unmerged work; no two parallel tasks edit the same files; qa on every PR, security-reviewer on auth, access, secrets, infra or DATOMS credentials.

## Tasks

| Task | Branch | Base branch | PR | Status | Needs my decision |
|---|---|---|---|---|---|
| S2-02 DATOMS client (priority 1) | `S2-02-datoms-client` | `main` | [#11](https://github.com/Ahmed84Abdulsattar/Nexus/pull/11) | PR open; live test reported (bulk enabled, 22 assets, 8 DG Set); security: approve with fixes (3 Medium, 9 Low), Ready: qa + security findings all fixed (208 tests). Decisions recorded: seed comment + ADR 0011 note (8 DG sets), Q33 update from the live test. Note: also adds one ignore line to `packages/config/eslint/index.js`, which #10 edits too | (1) keep `null` parameter values as reported (shown as —) vs drop them; (2) are the 4 "Source -2 DG-xxxx (Channel n)" assets separate generators?; (3) raise missing bulk fields (site, status, location, type, alerts) with DATOMS; (4) the API's `pnpm dev` loads the root `.env`, so in local dev the API process also holds `DATOMS_TOKEN`: move the test key to a separate git-ignored file read only by the DATOMS CLI/worker (e.g. `packages/datoms-client/.env.datoms`)? |
| S1-01 Core data model and migrations | `S1-01-database` | `main` | [#16](https://github.com/Ahmed84Abdulsattar/Nexus/pull/16) | PR open; all checks pass (33 DB + 136 API + 4 worker tests on local Postgres); every screen query under its N-04 target on the 100-site seed. security: approve with fixes (5 Medium, 9 Low; e.g. worker could write per-user read state and drop audit partitions; `db:migrate down` unguarded), qa PASS (CI green, 11 tests added incl. cross-instance cache); security + qa fixes in progress | Decided 2026-10-14: all accepted; sign-in gap = setting `audit.sign_in_gap_minutes` (default 60). Was: (1) sign-in audit = one row per first request after 30 idle min; (2) API grants narrowed (no writes to access.role / role_permission / permission, no user delete); (3) LISTEN needs a direct Postgres connection (not PgBouncer); (4) typed tables in a new `@nexus/db` package (`db/src/types.ts`) instead of `apps/api/src/common/db/` (docs/05 to update); (5) `db/bench/*.sql` replaced by TypeScript; (6) the DB URL fallbacks apply only when `APP_ENV=local` |
| S1-09 API baseline protections | `S1-09-api-protections` | `S1-01-database` | [#20](https://github.com/Ahmed84Abdulsattar/Nexus/pull/20) | PR open (stacked on #16); 172 API tests (36 new); qa + security queued. Must merge in S1-01's security fixes once pushed | CORS origins unset outside local = browser refused (fails closed). Make `CORS_ALLOWED_ORIGINS` required outside local? `TRUST_PROXY` for Azure is Q46 |
| S1-10 `/v1/me` and `/v1/config` | `S1-10-me-config` | `S1-09-api-protections` | — | In progress | — |
| S0-05 Web app shell and routing | `S0-05-web-shell` | `main` | [#10](https://github.com/Ahmed84Abdulsattar/Nexus/pull/10) | Ready: qa PASS (9 tests added) | — |
| S0-06 Design tokens and base components | `S0-06-design-tokens` | `S0-05-web-shell` | [#12](https://github.com/Ahmed84Abdulsattar/Nexus/pull/12) | PR open (stacked on #10); Ready: qa findings fixed (axe in CI tests, Playwright spec + 4 screenshots, SidePanel focus, typed Tag tokens). Follow-up: wire Playwright into ci.yml | Confirm the provisional colour values (e.g. In bid = lime `#4d7c0f` because a light yellow fails AA); dark mode follows the OS by default; add Playwright later? |
| S1-05 App header and user menu | `S1-05-app-header` | `S0-06-design-tokens` | [#13](https://github.com/Ahmed84Abdulsattar/Nexus/pull/13) | Ready: qa PASS (10 tests added); S0-06 fixes merged in, search landmark named so axe passes. User menu shows "Not signed in" until S0-08 (Entra) | Is there a header mockup image? (brief/structure don't describe it; built from the backlog list with a text wordmark). Is the "UAE" label static branding? |
| S0-09 Map wrapper and ArcGIS adapter | `S0-09-map-wrapper` | `S0-06-design-tokens` | [#19](https://github.com/Ahmed84Abdulsattar/Nexus/pull/19) | PR open (stacked on #12 → #10); checks pass; real map render and Key Vault BLOCKED (no ArcGIS key, Q4/Q23; e2e spec skips). security: approve with fixes (7 Low: e2e loads whole root `.env`, build guards bypassable, VITE_ allow-list, export of `authMiddleware(origin)`, https API base in prod, ArcGIS assets from CDN, runbook). qa running; fixes after qa. Conflict to expect: S0-09 and S1-07 both add the TanStack Query provider in `providers.tsx` | ArcGIS SDK cannot fit one 2 MB chunk (4.07 MB gz): split into 1,037 lazy chunks, 1.12 MB gz to open the map (re-measure with a real key). Web build needs `--max-old-space-size=6144`. SDK assets load from Esri's CDN (CSP in S7-02) |
| S1-06 Responsive layout | `S1-06-responsive-layout` | `S1-05-app-header` | [#15](https://github.com/Ahmed84Abdulsattar/Nexus/pull/15) | PR open (stacked on #13 → #12 → #10); Ready: qa PASS (23 e2e tests added), no bugs. Portfolio page adopts it after S0-09 | Breakpoints: desktop ≥1280, tablet 768–1279, mobile <768 (so 1024 is tablet, list as a button). Docs conflict: docs/11 says tablet project page = map on top + boxes in a 2-column grid, and the portfolio list is a RIGHT panel; backlog says list left, details right. Update docs/11 or add a right-list option in S2? |
| S1-07 Loading, error and empty states | `S1-07-ui-states` | `S1-06-responsive-layout` | [#17](https://github.com/Ahmed84Abdulsattar/Nexus/pull/17) | PR open (stacked on #15 → #13 → #12 → #10); Ready: qa findings fixed (`84a4df7`; HTTP-date Retry-After, NaN/blank → —, date shown when not today). Portfolio page adopts it after S0-09 | Retry policy: 4xx/429 never auto-retried (button instead), 5xx/network retried twice (1 s, 2 s) |
| Sprint plans S1 and S2 (architect) + decisions | `docs/sprint-S1-S2` | `main` | [#18](https://github.com/Ahmed84Abdulsattar/Nexus/pull/18) | Decisions recorded; open questions Q37–Q46 added; backlog rows S1-10, S3-08, S3-09 added (the xlsx needs them by hand) | — |
| ADR 0012 project source identity (architect) | `docs/adr-0012` | `main` | — | In progress | — |
| S3-01 Catalogue sync, phase 1 (connector + pure catalogue/retire logic) | `S3-01-catalogue-sync` | `S2-02-datoms-client` | — (opened after phase 2) | Phase 1 pushed (`f591f0a`, 24 tests; all 22 fixture assets map to the 4 seeded types). Phase 2 (Kysely repository, worker job, leader lock) waits for S1-01 | (1) `integration.sync_run` has no summary column: add `details jsonb`? (2) store DATOMS `lifecycle_status` (no column today)? (3) typed home for `retire_blocked` / `incomplete_walk` alerts? |
| S5-04 Load-test harness | `S5-04-load-harness` | `main` | [#14](https://github.com/Ahmed84Abdulsattar/Nexus/pull/14) | Ready: qa PASS, all findings fixed (8 generator tests). k6 smoke run against `/health/live` passed (p95 21 ms); data endpoints listed but disabled until they exist | Thresholds: docs give latest-value p95 < 300 ms and one-year chart < 1 s; harness applies them to search and 30-day charts. No doc backs search < 300 ms: confirm or use the 2 s page budget. |
| GETTING-STARTED pg-local command | `docs/getting-started-pg-local` | `main` | [#8](https://github.com/Ahmed84Abdulsattar/Nexus/pull/8) | PR open (docs only) | — |
| This progress file | `docs/progress-today` | `main` | [#9](https://github.com/Ahmed84Abdulsattar/Nexus/pull/9) | Updated through the day | — |

Note 2026-10-14: all running agents were stopped on 2026-10-12 by the Claude session limit; resumed 2026-10-14 from their uncommitted work. Nothing was lost.

## Decisions by Ahmed (2026-10-14)

| Area | Decision | Where recorded |
|---|---|---|
| S1-01 | All accepted. Sign-in audit gap is the setting `audit.sign_in_gap_minutes`, default 60; switch to Entra `sid` if S0-04 confirms it (Q38). Narrower grants, direct Postgres connection for LISTEN, `@nexus/db` package, TypeScript benchmarks, migrations as `nexus_migrator`, fake demo group GUIDs accepted. docs/05, 08, 14 updated in the PR. | PR #16 (being applied), `docs/sprints/S1.md` §8 |
| S1 D1 | Portfolio keeps PR #15's layout (list left, map centre, details right) unless the mockup says otherwise (Q37); docs/11 wins for the project page and phone. | docs/11 in PR #15 (`932a7af`) |
| S1 D2 | New task S1-10 (`/v1/me`, `/v1/config`) after S1-09. | backlog.md + S1.md (PR #18) |
| S1 D4 | New task S3-08 partition maintenance job (critical), merged before or with S3-03. | backlog.md (PR #18) |
| S1 D5 | IP limit before auth + per-user limit after; per-replica counters. | PR #20 |
| S1 D6 | S1-08 merges on mocked data. | S1.md (PR #18) |
| S2 D1–D10 | Sample seed local/dev, empty prod; new task S3-09 (R-63 admin projects API); S2-03 merges on part A; "—" until Q18; store users' last-token groups; 409 on removing the last admin mapping; the (d) answers (`sync_run.details`, `asset.source_lifecycle_status`, typed warnings) and the catalogue as source of asset category; S2-04 stacks on S2-01; real-fixture benchmark in S3-03; ADR 0012 (project identity, link table) before S3-09 and S3-02. | S2.md (PR #18) |
| DATOMS | "(18)" is the category id; 8 DG sets. Live S3-03 testing must finish before the test key expires on **10 Nov 2026**. | PR #11 (seed comment + ADR 0011, `3ad1af9`); S2.md |

## Queue (next unblocked, backlog order)

| Task | Agent | Planned base | Why that base |
|---|---|---|---|
| S1-04 Audit log | backend-api | `S1-10-me-config` | Needs the DB; edits `app.module.ts`, `docs/10`, OpenAPI |
| S3-01 phase 2 (Kysely repository, worker job, leader lock, `sync_run.details`, `source_lifecycle_status`) | datoms-integration | `S3-01-catalogue-sync` + merge `S1-01-database` | Needs both |
| S3-08 Partition maintenance job (critical) | datoms-integration / database | after S3-01 phase 2 | Needs the worker scheduler and leader lock |
| S1-08 Navigation by role (mocked data) | frontend | after S1-10 | Needs `/v1/me` in the OpenAPI |
| S2-01 Projects API | backend-api | after S1-04 | Needs S1-09 and the DB |
| S2-06 Users and roles API | backend-api | after S2-01 | Needs the audit log |
| S2-04 / S2-05 Project list and filters | frontend | on S2-01 (D8) | Needs the DTOs |
| S3-09 Admin projects API (R-63) | backend-api | after ADR 0012, S2-06 | D2/D10 |

## Blocked (skipped)

| Task | Reason |
|---|---|
| S0-02 Azure dev (Bicep) | Azure not provided (Q25) |
| S0-03 CI/CD deploy to dev | Azure not provided (Q25), repo owner/OIDC (Q26) |
| S0-04 Entra app registrations | Entra ID not provided (Q16, Q24) |
| S0-07 Static Web Apps deploy | Azure not provided (Q25) |
| S0-08 MSAL sign-in | Entra ID not provided (S0-04) |
| S1-08 Navigation by role (real sign-in check only) | Needs MSAL (S0-08, Entra); the rest merges on mocked data (D6) |
| S2-03 Portfolio map | ArcGIS key not provided (Q4, Q23); site location fields not provided (Q21, Q22) |
| S3-04 History backfill | On hold (ADR 0010, Q12) |
| S4-05 Asset pins | Location and status fields (Q22), blink vs pulse (Q19) |
| S5-01 / S5-02 Energy API and table | Site totals and ownership (Q3), field names (Q22) |
| S6-04 Notifications | Alert field names (Q22) |
| S7-02, S7-05, S8-02, S10-02 | Azure not provided |
| S8-05 Pen test | External pen-test slot |
| S9-*, S10-01, S10-03 | Pilot users / rollout |
