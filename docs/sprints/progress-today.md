# Progress log (started 2026-10-12; updated 2026-10-19)

Running log kept by the orchestrator session. Nothing here is merged by an agent; Ahmed merges at the end of the day.
Rules followed: never merge; one backlog task per branch; stacked PRs when a task needs unmerged work; no two parallel tasks edit the same files; qa on every PR, security-reviewer on auth, access, secrets, infra or DATOMS credentials.

## Status on 2026-10-19

**Stopped by Ahmed on 2026-10-19.** Next session: restart #25's qa + security review and S3-08 first (critical path to S3-03 before the test key expires on 10 Nov), then the S1-10 review fixes.

**Merged by Ahmed:** #8, #9, #10 (S0-05), #11 (S2-02), #12 (S0-06), #13 (S1-05), #14 (S5-04), #15 (S1-06), #16 (S1-01), #17 (S1-07), #18 (sprint plans + decisions), #19 (S0-09), #20 (S1-09), #21 (ADR 0012), #22 (S1-10), #23 (qa rule), #24 (datoms-client test fix).

Conflicts after the merges were resolved on the branches (merge commits, no force-push): #16 (`88b62e7`), #18 (`79f8888`), #20 (`0435dc2`), #19 (`f973a0f`). #18's CI failure was a flaky datoms-client test from #11, fixed in #24.

| Task | Branch | Base branch | PR | Status | Needs my decision |
|---|---|---|---|---|---|
| S1-10 review fixes (OpenAPI nullable, docs/08) | `S1-10-review-fixes` | `main` | — | Stopped before any push; restart (#22 merged before its review fixes) | UAE extent 51.0–57.0 E, 22.0–26.6 N: confirm |
| S3-01 Catalogue sync (phases 1 + 2) | `S3-01-catalogue-sync` | `main` | [#25](https://github.com/Ahmed84Abdulsattar/Nexus/pull/25) | PR open; migration `0002`; derived miss counter; leader lock + scheduler; qa + security review stopped before reporting: restart them | — |
| S3-08 Partition maintenance job (critical) | `S3-08-maintenance-job` | `S3-01-catalogue-sync` | — | Stopped before any push; restart first after #25's reviews | — |
| ADR 0012 doc follow-ups (00, 02, 03, 06, 07, 08, 10, 13, 14) | — | `main` | — | Queued (architect) | — |
| QA of merged S1-09 + S1-10 on main | — | — | — | Queued (they merged before QA ran) | — |
| S3-03 Live poll | — | after S3-08 | — | Queued; must finish live testing before the DATOMS test key expires on **10 Nov 2026** (production key requested by 1 Nov) | — |

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
