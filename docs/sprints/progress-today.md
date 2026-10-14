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
| S1-05 App header and user menu | `S1-05-app-header` | `S0-06-design-tokens` | [#13](https://github.com/Ahmed84Abdulsattar/Nexus/pull/13) | Ready: qa PASS (10 tests added); S0-06 fixes merged in, search landmark named so axe passes. User menu shows "Not signed in" until S0-08 (Entra) | Is there a header mockup image? (brief/structure don't describe it; built from the backlog list with a text wordmark). Is the "UAE" label static branding? |
| S0-09 Map wrapper and ArcGIS adapter | `S0-09-map-wrapper` | `S0-06-design-tokens` | — | In progress (key read from `/v1/config` MSW mock; real map render blocked: no ArcGIS key, Q4/Q23) | — |
| S1-06 Responsive layout | `S1-06-responsive-layout` | `S1-05-app-header` | [#15](https://github.com/Ahmed84Abdulsattar/Nexus/pull/15) | PR open (stacked on #13 → #12 → #10); Ready: qa PASS (23 e2e tests added), no bugs. Portfolio page adopts it after S0-09 | Breakpoints: desktop ≥1280, tablet 768–1279, mobile <768 (so 1024 is tablet, list as a button). Docs conflict: docs/11 says tablet project page = map on top + boxes in a 2-column grid, and the portfolio list is a RIGHT panel; backlog says list left, details right. Update docs/11 or add a right-list option in S2? |
| S1-07 Loading, error and empty states | `S1-07-ui-states` | `S1-06-responsive-layout` | — | In progress (portfolio page adopts it after S0-09) | — |
| S3-01 Catalogue sync, phase 1 (connector + pure catalogue/retire logic) | `S3-01-catalogue-sync` | `S2-02-datoms-client` | — | In progress. Phase 2 (DB repository, worker job, leader lock) after S1-01; then it also needs `S1-01-database` merged in | — |
| S5-04 Load-test harness | `S5-04-load-harness` | `main` | [#14](https://github.com/Ahmed84Abdulsattar/Nexus/pull/14) | Ready: qa PASS, all findings fixed (8 generator tests). k6 smoke run against `/health/live` passed (p95 21 ms); data endpoints listed but disabled until they exist | Thresholds: docs give latest-value p95 < 300 ms and one-year chart < 1 s; harness applies them to search and 30-day charts. No doc backs search < 300 ms: confirm or use the 2 s page budget. |
| GETTING-STARTED pg-local command | `docs/getting-started-pg-local` | `main` | [#8](https://github.com/Ahmed84Abdulsattar/Nexus/pull/8) | PR open (docs only) | — |
| This progress file | `docs/progress-today` | `main` | [#9](https://github.com/Ahmed84Abdulsattar/Nexus/pull/9) | Updated through the day | — |

Note 2026-10-14: all running agents were stopped on 2026-10-12 by the Claude session limit; resumed 2026-10-14 from their uncommitted work. Nothing was lost.

## Queue (next unblocked, backlog order)

| Task | Agent | Planned base | Why that base |
|---|---|---|---|
| S1-09 API baseline protections | backend-api | `S1-01-database` | Both edit `apps/api` config, `.env.example`, `docs/04` |
| S1-04 Audit log | backend-api | `S1-09-api-protections` | Needs the DB (S1-01); edits `app.module.ts`, `docs/10`, OpenAPI like S1-09 |
| S2-01 Projects API | backend-api | after S1-04 | Needs S1-09 (backlog) and the DB |
| S2-06 Users and roles API | backend-api | after S2-01 | Needs the audit log |

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
