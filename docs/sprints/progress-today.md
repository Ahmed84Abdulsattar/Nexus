# Progress log (started 2026-10-12)

Running log kept by the orchestrator session. Nothing here is merged by an agent; Ahmed merges at the end of the day.
Rules followed: never merge; one backlog task per branch; stacked PRs when a task needs unmerged work; no two parallel tasks edit the same files; qa on every PR, security-reviewer on auth, access, secrets, infra or DATOMS credentials.

## Tasks

| Task | Branch | Base branch | PR | Status | Needs my decision |
|---|---|---|---|---|---|
| S2-02 DATOMS client (priority 1) | `S2-02-datoms-client` | `main` | [#11](https://github.com/Ahmed84Abdulsattar/Nexus/pull/11) | PR open; live test reported (bulk enabled, 22 assets, 8 DG Set); security: approve with fixes (3 Medium, 9 Low), Ready: qa + security findings all fixed (208 tests). Note: also adds one ignore line to `packages/config/eslint/index.js`, which #10 edits too | (1) keep `null` parameter values as reported (shown as —) vs drop them; (2) are the 4 "Source -2 DG-xxxx (Channel n)" assets separate generators?; (3) raise missing bulk fields (site, status, location, type, alerts) with DATOMS; (4) the API's `pnpm dev` loads the root `.env`, so in local dev the API process also holds `DATOMS_TOKEN`: move the test key to a separate git-ignored file read only by the DATOMS CLI/worker (e.g. `packages/datoms-client/.env.datoms`)? |
| S1-01 Core data model and migrations | `S1-01-database` | `main` | — | In progress | — |
| S0-05 Web app shell and routing | `S0-05-web-shell` | `main` | [#10](https://github.com/Ahmed84Abdulsattar/Nexus/pull/10) | Ready: qa PASS (9 tests added) | — |
| S0-06 Design tokens and base components | `S0-06-design-tokens` | `S0-05-web-shell` | [#12](https://github.com/Ahmed84Abdulsattar/Nexus/pull/12) | PR open (stacked on #10); Ready: qa findings fixed (axe in CI tests, Playwright spec + 4 screenshots, SidePanel focus, typed Tag tokens). Follow-up: wire Playwright into ci.yml | Confirm the provisional colour values (e.g. In bid = lime `#4d7c0f` because a light yellow fails AA); dark mode follows the OS by default; add Playwright later? |
| S1-05 App header and user menu | `S1-05-app-header` | `S0-06-design-tokens` | [#13](https://github.com/Ahmed84Abdulsattar/Nexus/pull/13) | PR open (stacked on #12 → #10); qa running. User menu shows "Not signed in" until S0-08 (Entra) | Is there a header mockup image? (brief/structure don't describe it; built from the backlog list with a text wordmark) |
| S0-09 Map wrapper and ArcGIS adapter | `S0-09-map-wrapper` | `S0-06-design-tokens` | — | In progress (key read from `/v1/config` MSW mock; real map render blocked: no ArcGIS key, Q4/Q23) | — |
| S5-04 Load-test harness | `S5-04-load-harness` | `main` | — | In progress (runs against `/health/live` now; data endpoints disabled until they exist) | — |
| GETTING-STARTED pg-local command | `docs/getting-started-pg-local` | `main` | [#8](https://github.com/Ahmed84Abdulsattar/Nexus/pull/8) | PR open (docs only) | — |
| This progress file | `docs/progress-today` | `main` | [#9](https://github.com/Ahmed84Abdulsattar/Nexus/pull/9) | Updated through the day | — |

Note 2026-10-14: all running agents were stopped on 2026-10-12 by the Claude session limit; resumed 2026-10-14 from their uncommitted work. Nothing was lost.

## Queue (next unblocked, backlog order)

| Task | Agent | Planned base | Why that base |
|---|---|---|---|
| S1-09 API baseline protections | backend-api | `S1-01-database` | Both edit `apps/api` config, `.env.example`, `docs/04` |
| S1-04 Audit log | backend-api | `S1-09-api-protections` | Needs the DB (S1-01); edits `app.module.ts`, `docs/10`, OpenAPI like S1-09 |
| S1-07 Loading, error and empty states | frontend | after S0-06 | Shares `components/feedback/` |
| S2-01 Projects API | backend-api | after S1-04 | Needs S1-09 (backlog) and the DB |
| S2-06 Users and roles API | backend-api | after S2-01 | Needs the audit log |
| S3-01 Catalogue sync (assets only; sites wait for Q21/Q22) | datoms-integration | `S2-02-datoms-client` + `S1-01-database` | Needs both |

## Blocked (skipped)

| Task | Reason |
|---|---|
| S0-02 Azure dev (Bicep) | Azure not provided (Q25) |
| S0-03 CI/CD deploy to dev | Azure not provided (Q25), repo owner/OIDC (Q26) |
| S0-04 Entra app registrations | Entra ID not provided (Q16, Q24) |
| S0-07 Static Web Apps deploy | Azure not provided (Q25) |
| S0-08 MSAL sign-in | Entra ID not provided (S0-04) |
| S1-08 Navigation by role | Needs signed-in user from MSAL (S0-08, Entra) |
| S2-03 Portfolio map | ArcGIS key not provided (Q4, Q23); site location fields not provided (Q21, Q22) |
| S3-04 History backfill | On hold (ADR 0010, Q12) |
| S4-05 Asset pins | Location and status fields (Q22), blink vs pulse (Q19) |
| S5-01 / S5-02 Energy API and table | Site totals and ownership (Q3), field names (Q22) |
| S6-04 Notifications | Alert field names (Q22) |
| S7-02, S7-05, S8-02, S10-02 | Azure not provided |
| S8-05 Pen test | External pen-test slot |
| S9-*, S10-01, S10-03 | Pilot users / rollout |
