# Phase 1 backlog (markdown copy of Nexus_Phase1_Sprint_Plan.xlsx → Backlog)

> Read-only copy for agents. The spreadsheet is the source and tracks status. Regenerate this file when the sheet changes.
> Map decided: Esri ArcGIS (docs/adr/0002). Database: PostgreSQL 16 without TimescaleDB (docs/adr/0003). Where a task disagrees with docs/, docs/ wins.
> Regenerated from the spreadsheet on 2026-10-08 after architecture review 1 (ADRs 0005–0010). Changed rows: the sprint dependencies for S2–S6, S0-04, S2-02, S3-01, S3-03, S3-04 (on hold), S4-01, S4-02, S4-03, S4-05, S5-01, S5-02, S5-03, S6-01, S6-02, S6-03, S6-04, S9-02.
> Changed on 2026-10-14 (S0-09 security review, accepted by Ahmed): extra steps in S0-03, S0-07, S0-08 and S7-02.
> Changed on 2026-10-14 (decisions by Ahmed on the S1/S2 sprint plans): new tasks S1-10, S3-08 and S3-09 added below. `Nexus_Phase1_Sprint_Plan.xlsx` needs the same three rows added by hand.
> Changed on 2026-10-12 (DATOMS provisional test key, docs/07 section 3): the S2 sprint dependency and S2-02 (Steps, External blocker, Acceptance check) now show S2-02 as unblocked.

## Sprints

| Sprint | Name | Weeks | Goal | External dependency |
|---|---|---|---|---|
| S0 | Setup + map decision | 1–2 | Repos, Azure dev environment, Microsoft sign-in skeleton, design tokens, ArcGIS map wrapper skeleton | Azure and Entra access; map decision |
| S1 | Foundation | 3–4 | Data model, permissions in the API, app shell, responsive layout | Nothing |
| S2 | Portfolio map + access | 5–6 | Top-level map of all DATOMS sites; DATOMS client; users and roles API | None to start S2-02 (DATOMS test key received 2026-10-12; bulk access checked in S2-02, Q34). Site field names still pending (Q21, Q22) |
| S3 | DATOMS sync + admin | 7–8 | Live DATOMS data flowing; device linking, sync health, users and roles screens | DATOMS sample + field list (Q21, Q22) + key |
| S4 | Project page | 9–10 | Level 1 page with live asset pins and equipment / energy boxes | Bulk field names for location + status (Q22) |
| S5 | Energy | 11–12 | Info box 3 and energy detail page; load-test harness | Whether DATOMS has site totals and ownership (Q3); field names (Q22) |
| S6 | Equipment + notifications | 13–14 | Info box 2, equipment detail, device card, DATOMS notifications | Alert field names in the bulk response (Q22) |
| S7 | Explorer + hardening | 15–16 | All DATOMS data explorer, security hardening, production environment, mobile polish | Nothing |
| S8 | Load and security | 17–18 | Load test at 100+ sites, backups and alerts, penetration test, user guide | Pen-test slot |
| S9 | Pilot (GHAFWOODS) | 19–20 | Testing with pilot users, fixes, runbook | Pilot users |
| S10 | Rollout | 21–22 | All DATOMS sites live, onboarding, plan the next scope | Nothing |

## Tasks

### S0-01 · Monorepo: apps/web, apps/api, apps/worker, packages/shared (types). Branching and review rules
- **Sprint:** S0
- **Week:** W1
- **Work package:** Setup
- **Steps (how to do it):** 1. Create the Git repository (GitHub or Azure DevOps).
  2. Set up folders: apps/web, apps/api, apps/worker, packages/shared.
  3. Add a root README with how to run everything.
  4. Agree rules: main branch protected, every change via pull request reviewed by the other person.
- **Output when done:** Repo both of you can clone and run
- **Now done by:** You (backend)
- **Requirement:** Foundation
- **Estimate (days):** 1
- **Acceptance check:** Both devs clone, build and run all apps locally with one command

### S0-02 · Azure dev environment as code (Bicep): Container Apps, PostgreSQL Flexible Server 16, Blob Storage, Key Vault, Web PubSub, Application Insights
- **Sprint:** S0
- **Week:** W1
- **Work package:** Setup
- **Steps (how to do it):** 1. Create a resource group in Azure UAE North for 'nexus-dev'.
  2. Write Bicep files for: PostgreSQL Flexible Server 16 (no TimescaleDB; see docs/adr/0003), Blob Storage, Key Vault, Web PubSub, Container Apps environment, Application Insights.
  3. Deploy with one command and check each resource exists.
  4. Store the database password in Key Vault, not in code.
- **Output when done:** Working dev environment in Azure, built from code
- **Now done by:** You (backend)
- **Requirement:** Foundation
- **External blocker:** Azure subscription access
- **Estimate (days):** 3
- **Acceptance check:** Environment created from code in one run; no secrets in the repo

### S0-03 · CI/CD pipelines for API and worker (build, test, deploy to dev)
- **Sprint:** S0
- **Week:** W2
- **Work package:** Setup
- **Steps (how to do it):** 1. Create a pipeline that runs on every pull request: install, lint, test.
  2. On merge to main: build Docker images for api and worker, push to Azure Container Registry, deploy to Container Apps (dev).
  3. Test by merging a small change and seeing it live.
  4. Add `pnpm audit --prod` to the PR pipeline. Check whether `@vaadin/vaadin-usage-statistics` (pulled in by `@arcgis/core`) sends usage data at run time, and disable it if it does (security review of S0-09, item I6, 2026-10-14). This step needs no Azure access and is done ahead of the rest of S0-03.
- **Output when done:** Merge to main = deployed to dev
- **Now done by:** You (backend)
- **Requirement:** Foundation
- **Depends on:** S0-02
- **Estimate (days):** 2
- **Acceptance check:** Merge to main deploys to dev automatically

### S0-04 · Entra ID app registrations (API + web app), Nexus security groups, app-assigned groups claim
- **Sprint:** S0
- **Week:** W1
- **Work package:** Setup
- **Steps (how to do it):** 1. In Entra ID, register two apps: 'Nexus API' and 'Nexus Web'.
  2. Create the Nexus security groups (docs/08 section 1; e.g. Nexus-Admins). Roles are mapped from groups in the Nexus database (docs/08 section 3), not defined as Entra app roles. The final role list is Q17.
  3. On Nexus API, set the groups claim to 'Groups assigned to the application' (ADR 0008). Assign the Nexus groups to the enterprise app; users must be direct members. No Graph permission or secret.
  4. Turn on 'assignment required' so only group members can sign in.
  5. Share client IDs with the frontend.
- **Output when done:** Sign-in apps and groups ready; test users in each group
- **Now done by:** You (backend)
- **Requirement:** Innovo: permissions
- **External blocker:** Entra admin consent; Entra ID P1 licence and setup confirmed by Innovo IT (Q16)
- **Estimate (days):** 1
- **Acceptance check:** Test users in each group get a token whose groups claim contains only their app-assigned Nexus group(s)

### S0-05 · React + TypeScript app shell (Vite), routing, linting
- **Sprint:** S0
- **Week:** W1
- **Work package:** Setup
- **Steps (how to do it):** 1. Create the React + TypeScript app with Vite in apps/web.
  2. Add routing with empty pages: Portfolio, Project, Admin.
  3. Add ESLint and Prettier.
  4. Run locally.
- **Output when done:** Empty app with page routes
- **Now done by:** Colleague (frontend)
- **Requirement:** Foundation
- **Depends on:** S0-01
- **Estimate (days):** 2
- **Acceptance check:** App runs locally and in dev

### S0-06 · Design tokens and base components from the brief mockups (colours, type, cards, tags, tables)
- **Sprint:** S0
- **Week:** W1–W2
- **Work package:** Setup
- **Steps (how to do it):** 1. From the brief mockups, list colours, fonts, spacing, corner radius.
  2. Create them as design tokens (CSS variables).
  3. Build base components: button, card, info box, tag (RES, HOSP...), table, side panel, tabs.
  4. Make a 'components' page showing them all.
- **Output when done:** Reusable UI building blocks matching the mockups
- **Now done by:** Colleague (frontend)
- **Requirement:** Brief: platform experience
- **Estimate (days):** 3
- **Acceptance check:** Component page shows every base component on desktop and mobile

### S0-07 · CI/CD to Azure Static Web Apps
- **Sprint:** S0
- **Week:** W2
- **Work package:** Setup
- **Steps (how to do it):** 1. Create Azure Static Web App for dev.
  2. Add a pipeline: on merge to main, build and deploy apps/web.
  3. Check the dev URL works.
  4. The deploy must build with `pnpm --filter @nexus/web build`, so the build-time guards run (no MSW, no sample data, no dev key in `dist/`; security review of S0-09, item L2, 2026-10-14).
  5. The static host must serve HTTP/2 or later, with a long immutable cache for the hashed files under `assets/` and `assets/arcgis/*` (about 1,000 ArcGIS chunks; QA of S0-09, 2026-10-14).
- **Output when done:** Web app auto-deploys to dev
- **Now done by:** You (backend)
- **Requirement:** Foundation
- **Depends on:** S0-05
- **Estimate (days):** 1
- **Acceptance check:** Merge to main deploys web app to dev

### S0-08 · Microsoft sign-in skeleton (MSAL)
- **Sprint:** S0
- **Week:** W2
- **Work package:** Setup
- **Steps (how to do it):** 1. Install MSAL React.
  2. Use the 'Nexus Web' client ID from S0-04.
  3. Sign-in button redirects to Microsoft; after sign-in show the user's name.
  4. Test with a user outside the Nexus groups: they must be refused.
  5. On sign-out: `queryClient.clear()` (drops the previous user's cached data) and `esriConfig.apiKey = undefined` through the map adapter (security review of S0-09, item I3, 2026-10-14).
- **Output when done:** Users sign in with their Innovo Microsoft account
- **Now done by:** Colleague (frontend)
- **Requirement:** Innovo: permissions
- **Depends on:** S0-04
- **Estimate (days):** 1
- **Acceptance check:** User signs in with Innovo account; others are refused

### S0-09 · ArcGIS map setup (provider decided: Esri ArcGIS, ADR 0002): account and API key, MapView wrapper skeleton with the ArcGIS adapter
- **Sprint:** S0
- **Week:** W1
- **Work package:** Map
- **Steps (how to do it):** 1. Ask Innovo IT whether Innovo has an ArcGIS Online / Enterprise organisation (open question Q4).
  2. Create the ArcGIS API key (basemaps + elevation), restrict it by referrer to the Nexus domains, store it in Key Vault.
  3. Serve the key to the web app through /v1/config (stub until the API exists).
  4. Build components/map/types.ts, MapView.tsx and the arcgis/ adapter: lazy-loaded @arcgis/core, a UAE map with 10 sample markers, 2D / satellite / 3D switch.
  5. Add the lint rule that blocks @arcgis imports outside components/map.
- **Output when done:** ArcGIS key in Key Vault; MapView wrapper with ArcGIS adapter showing a UAE map in 2D, satellite and 3D; ready for S2
- **Now done by:** Colleague (frontend)
- **Requirement:** Brief: interactive map; Sheet: Top level
- **External blocker:** ArcGIS account / licence (Q4)
- **Estimate (days):** 3
- **Acceptance check:** UAE map renders in 2D, satellite and 3D through <MapView>; no @arcgis import outside components/map; key not in the repo

### S1-01 · Core data model and migrations from db/schema.sql: project, building, level, zone, asset type, asset, parameter dictionary, latest + raw packets (daily partitions), rollups, status, location, events, access, audit
- **Sprint:** S1
- **Week:** W1
- **Work package:** Foundation
- **Steps (how to do it):** 1. Use Kysely + plain SQL migrations (node-pg-migrate), per docs/04-tech-stack.md.
  2. Turn db/schema.sql into migration 0001_init.sql (up + down); add db/roles.sql grants.
  3. Raw telemetry is telemetry.packet: one jsonb row per asset packet, daily partitions (no TimescaleDB).
  4. Every asset has project_id and optional building/level/zone ids (what BIM links to later).
  5. Add pnpm db:migrate / db:check / db:seed; run the 100-site seed and record query timings.
  6. From the S1-02 security review (L3, accepted for now): when roles, project scope or active status change, clear the access cache on every API instance (Postgres LISTEN/NOTIFY or a per-user access version), check is_active on a cache hit, and never cache a load that started before the change.
  7. Wire db/seeds/dev-login-roles.sql into pnpm db:seed for APP_ENV=local only: the runner skips it in every other environment and sets nexus.app_env before running it (the file refuses otherwise). It creates passwordless LOGIN users nexus_api_local / nexus_worker_local, members of nexus_api / nexus_worker from db/roles.sql, and needs a role that can create roles (locally the superuser nexus). Locally the api connects as nexus_api_local and the worker as nexus_worker_local, each with its own DATABASE_URL (docs/04).
- **Output when done:** Database structure in place
- **Now done by:** You (backend)
- **Requirement:** Foundation (BIM-ready)
- **Depends on:** S0-02
- **Estimate (days):** 3
- **Acceptance check:** Migrations run clean; every asset links to project and optional zone

### S1-02 · Auth in API: token validation, role guards, project-scope filter on every query
- **Sprint:** S1
- **Week:** W1–W2
- **Work package:** Foundation
- **Steps (how to do it):** 1. Add token validation in NestJS for Entra ID tokens.
  2. Read the user's roles from the token.
  3. Add a guard that blocks endpoints by role.
  4. Add a project-scope filter: every query only returns projects the user is assigned to (unless role = all projects).
  5. Write tests: user A must never see project B.
- **Output when done:** Every API call is permission-checked
- **Now done by:** You (backend)
- **Requirement:** Innovo: permissions
- **Depends on:** S0-04
- **Estimate (days):** 3
- **Acceptance check:** Automated test: a user never receives a project outside their scope

### S1-03 · OpenAPI contract published; typed client generated for the web app
- **Sprint:** S1
- **Week:** W2
- **Work package:** Foundation
- **Steps (how to do it):** 1. Turn on NestJS Swagger/OpenAPI generation.
  2. Publish the spec at /docs and /openapi.json on local and dev (not in prod).
  3. Generate the typed client (openapi-typescript + openapi-fetch) into apps/web/src/api/.
  4. Show the frontend how to use it.
- **Output when done:** Shared API contract the frontend codes against
- **Now done by:** You (backend)
- **Requirement:** Foundation
- **Estimate (days):** 1
- **Acceptance check:** Frontend imports generated client; build fails on contract mismatch

### S1-04 · Audit log: sign-ins, data exports, settings changes
- **Sprint:** S1
- **Week:** W2
- **Work package:** Foundation
- **Steps (how to do it):** 1. Create an audit service in the API.
  2. Log sign-ins, settings changes, permission changes, exports: who, what, when.
  3. Add an admin-only endpoint to read the log.
- **Output when done:** Audit log recording key actions
- **Now done by:** You (backend)
- **Requirement:** Innovo: security
- **Estimate (days):** 1
- **Acceptance check:** Each action writes user, time and action

### S1-05 · App shell: header, global search box, notifications bell, user menu
- **Sprint:** S1
- **Week:** W1
- **Work package:** Foundation
- **Steps (how to do it):** 1. Build the top header from the mockup: Innovo/Nexus logo, search box, UAE label, bell, user avatar.
  2. User menu shows name and sign-out.
  3. Search and bell are placeholders for now.
- **Output when done:** App frame visible on every page
- **Now done by:** Colleague (frontend)
- **Requirement:** Brief mockups
- **Depends on:** S0-06
- **Estimate (days):** 2
- **Acceptance check:** Matches mockup header on desktop

### S1-06 · Responsive layout for desktop, tablet and mobile
- **Sprint:** S1
- **Week:** W1–W2
- **Work package:** Foundation
- **Steps (how to do it):** 1. Desktop: list panel left, map centre, details panel right (as mockup).
  2. Tablet: list panel collapses to a button.
  3. Mobile: map full width, panels open as bottom drawers.
  4. Test at 1440, 1024 and 390 px wide.
- **Output when done:** Layout works on desktop, tablet and phone
- **Now done by:** Colleague (frontend)
- **Requirement:** Innovo: devices
- **Estimate (days):** 2
- **Acceptance check:** No horizontal scroll at 390 px; side panel becomes a drawer on mobile

### S1-07 · Loading, error and empty states using the generated API client
- **Sprint:** S1
- **Week:** W2
- **Work package:** Foundation
- **Steps (how to do it):** 1. Connect the generated API client from S1-03.
  2. Make shared components for: loading spinner, 'no data yet', error with retry.
  3. Use them on every page.
- **Output when done:** Consistent loading, empty and error states
- **Now done by:** Colleague (frontend)
- **Requirement:** Foundation
- **Depends on:** S1-03
- **Estimate (days):** 2
- **Acceptance check:** Every page shows a clear state when data is loading, missing or failed

### S1-08 · Navigation filtered by role
- **Sprint:** S1
- **Week:** W2
- **Work package:** Foundation
- **Steps (how to do it):** 1. Read the user's roles from the sign-in token.
  2. Hide Admin menu for non-admins.
  3. Hide pages the role cannot open.
- **Output when done:** Menus match the user's role
- **Now done by:** Colleague (frontend)
- **Requirement:** Innovo: permissions
- **Depends on:** S1-02
- **Estimate (days):** 1
- **Acceptance check:** Admin console hidden for non-admins

### S1-09 · API baseline protections: helmet, CORS for Nexus web origins only, per-user rate limit, request size limit, Swagger UI off in prod
- **Sprint:** S1
- **Week:** W2
- **Work package:** Foundation
- **Steps (how to do it):** 1. Add helmet (@fastify/helmet) so every API response carries secure headers.
  2. Enable CORS only for the Nexus web origins, read from config per environment (no wildcard); add the variable to .env.example and docs/04.
  3. Add a per-user rate limit keyed on the Entra oid (by IP before sign-in); over the limit gives 429 problem+json with Retry-After; limits come from config.
  4. Set a request body size limit (Fastify bodyLimit) from config; larger bodies get 413.
  5. Serve Swagger UI only when APP_ENV is not prod.
  6. Update docs/08 §6 and docs/10. Needed before S2-01 (security review of S1-02, item I6).
- **Output when done:** The API refuses other origins, oversized bodies and excessive requests, and sends secure headers
- **Now done by:** You (backend)
- **Requirement:** Innovo: security
- **Depends on:** S1-02
- **Estimate (days):** 1
- **Acceptance check:** Automated tests: a non-Nexus origin gets no CORS headers; a user over the limit gets 429 with Retry-After; an oversized body gets 413; secure headers on every response; Swagger UI gives 404 when APP_ENV=prod

### S1-10 · Current user and client config endpoints: GET /v1/me and GET /v1/config
- **Sprint:** S1
- **Week:** W2
- **Work package:** Foundation
- **Steps (how to do it):** 1. `GET /v1/me` (`@AnySignedIn`): the signed-in user's name, roles, permissions and project scope from the access context (docs/08 §5, docs/10).
  2. `GET /v1/config` (`@AnySignedIn`): feature flags, enums and the ArcGIS settings, including the per-environment ArcGIS key from config / Key Vault (docs/09, docs/10).
  3. Add both to OpenAPI and regenerate the typed web client; the web app's interim `/v1/config` and `/v1/projects` calls (S0-09 `pendingClient.ts`) switch to the typed client.
  (Added 2026-10-14 (architect S1 plan, decision D2).)
- **Output when done:** The web app can read who the user is and its runtime config from the API
- **Now done by:** You (backend)
- **Requirement:** Innovo: permissions; Brief: interactive map
- **Depends on:** S1-09
- **Estimate (days):** 1
- **Acceptance check:** Tests: `/v1/me` returns the caller's permissions and nothing else; `/v1/config` needs a valid sign-in and never returns a secret other than the referrer-restricted ArcGIS key; both appear in the generated client

### S2-01 · Projects API: list, filter (status, type, district), search, scoped to user
- **Sprint:** S2
- **Week:** W1
- **Work package:** Portfolio map
- **Steps (how to do it):** 1. Create GET /projects with filters: status, type, district, search text.
  2. Apply the project-scope filter from S1-02.
  3. Return the fields DATOMS provides for each site (name, location, type, status).
  4. Add seed data for 5 sample sites so the frontend can work before DATOMS is connected.
  5. Do not read any project source column (`source_system`, `external_id`, `source_payload`, `*_seen_at` on `core.project`): ADR 0012 drops them in S3-09. Source ids are not part of the normal project response.
- **Output when done:** Projects list endpoint the map uses
- **Now done by:** You (backend)
- **Requirement:** Sheet: Top level
- **Depends on:** S1-02, S1-09
- **Estimate (days):** 2
- **Acceptance check:** Returns only the user's projects; search under 300 ms

### S2-02 · DATOMS API client: bulk endpoint, paging, retries, rate-limit and credit handling
- **Sprint:** S2
- **Week:** W2
- **Work package:** DATOMS connector
- **Steps (how to do it):** 1. Read the v4 PDF, docs/07 section 3 (test key, what DATOMS has shared) and docs/source/datoms-parameters.md (parameter keys, names and units for DG Set, Fuel Tank, AC Sub-Meter, Solar Inverter; seeded per source type, ADR 0011). Use the DATOMS sample bulk response (Q21) and bulk field list (Q22) once received.
  2. Build packages/datoms-client: list assets (catalogue) and the bulk endpoint (fleet and id mode) as the ONLY telemetry source (ADR 0010). data/latest is for CLI checks only.
  3. Bulk check with the provisional test key (DATOMS_TOKEN only in the local .env; DATOMS_LIVE=true on a developer machine): make ONE bulk call in id mode with a few ids from the Asset List. Record the result in docs/07 section 3.3 and Q34 (no token, no headers). If bulk is enabled, save the response to fixtures/. If it is not, record that and keep the worker on fixtures; never fall back to data/latest (ADR 0010).
  4. Put ALL field mapping in src/mapping.ts. Until the sample arrives, build against the v4 PDF shape. Save recorded responses (Asset List, the bulk call) to fixtures/ with tokens and headers removed.
  5. Handle paging, 422 halving (with the learned page size), retries, rate limits, and the credit budget with budget.max_share (ADR 0005).
  6. Test against GHAFWOODS using fixtures or a small id-mode subset from a developer machine (never the full fleet; the test key is not in Key Vault, so the cloud dev worker stays on fixtures).
- **Output when done:** Code that can talk to DATOMS
- **Now done by:** You (backend)
- **Requirement:** Brief: energy, crane utilisation
- **External blocker:** None. Unblocked 2026-10-12: DATOMS provisional read-only test key for org 20283 (valid until 10 Nov 2026). Checked inside this task: whether the bulk endpoint is enabled for the key (Q34). Still pending, not blocking: site, location, status and alert field names (Q21, Q22); those mappings stay empty ("no data yet") until they arrive.
- **Estimate (days):** 3
- **Acceptance check:** One bulk call made with the test key and its result recorded in docs/07 section 3.3 and Q34. If bulk is enabled: the client reads a small id-mode subset of the live fleet through the bulk endpoint. If not: the client's tests pass on fixtures and the worker stays on fixtures. Either way: no data/latest call outside scripts/, and DATOMS field names exist only in src/mapping.ts

### S2-03 · Portfolio map (chosen provider, through the map wrapper): one pin per DATOMS site, coloured Active green, Central Store blue, Finished grey, In bid yellow where DATOMS gives the status
- **Sprint:** S2
- **Week:** W1–W2
- **Work package:** Portfolio map
- **Steps (how to do it):** 1. Use the MapView wrapper with the ArcGIS adapter from S0-09.
  2. Show a UAE map.
  3. Call GET /projects and draw one pin per project.
  4. Colour pins: Active green, Central Store blue, Finished grey, In bid yellow (structure sheet).
  5. Click a pin = zoom to that project.
  6. Acceptance is split (decision S2 D3): part A (no key, test data, stubbed tiles) is the merge gate. Part B runs when the ArcGIS key arrives (Q23): the real-key spec checks there are no failed `arcgis.com` / `basemaps3d` responses, the marker or cluster count equals the 10 sample projects, and a screenshot comparison passes (QA of S0-09, 2026-10-14).
- **Output when done:** Top-level portfolio map
- **Now done by:** Colleague (frontend)
- **Requirement:** Sheet: Top level
- **Depends on:** S0-09
- **Estimate (days):** 3
- **Acceptance check:** All projects shown; colours match the sheet; click zooms to project

### S2-04 · Project list panel and summary tiles (projects, districts)
- **Sprint:** S2
- **Week:** W2
- **Work package:** Portfolio map
- **Steps (how to do it):** 1. Left panel: list of sites with the details DATOMS provides (name, location, type, status).
  2. Two summary tiles at the top: number of projects, number of districts.
  3. Click a project in the list = same as clicking its pin.
- **Output when done:** Project list beside the map
- **Now done by:** Colleague (frontend)
- **Requirement:** Brief mockups
- **Depends on:** S2-01
- **Estimate (days):** 2
- **Acceptance check:** List matches mockup: name, district, type tag, client, consultant, PM

### S2-05 · Search and filters
- **Sprint:** S2
- **Week:** W2
- **Work package:** Portfolio map
- **Steps (how to do it):** 1. Search box filters the list and pins by name.
  2. Filter chips: status, type, district.
  3. Filters call GET /projects with parameters.
- **Output when done:** Users can find any project fast
- **Now done by:** Colleague (frontend)
- **Requirement:** Brief mockups
- **Depends on:** S2-01
- **Estimate (days):** 2
- **Acceptance check:** Filter by status, type, district; search by name

### S2-06 · Users and roles API: group-to-role mapping, project assignment, extra permissions
- **Sprint:** S2
- **Week:** W2
- **Work package:** Admin console
- **Steps (how to do it):** 1. Endpoint listing Entra groups and their Nexus role.
  2. Endpoints to assign users to projects. Keep room for extra permissions that later modules will need.
  3. Admin only; every change goes to the audit log.
- **Output when done:** Backend for managing access
- **Now done by:** You (backend)
- **Requirement:** Innovo: permissions
- **Depends on:** S1-02
- **Estimate (days):** 2
- **Acceptance check:** Changes take effect on next request

### S3-01 · Catalogue sync (hourly): sites, devices, parameters, units
- **Sprint:** S3
- **Week:** W1
- **Work package:** DATOMS connector
- **Steps (how to do it):** 1. Scheduled job in apps/worker, every hour (and early when the poll sees unknown ids).
  2. Read all DATOMS assets (list assets: names, nameplate). Sites, asset types and parameters (name, unit) come in the bulk rows. The live poll (S3-03) upserts them the same way, so the catalogue job spends no bulk credits.
  3. Insert new ones, update changed ones in the database.
  4. Retire safely (docs/07 section 6): only after a complete walk; only rows missed in 2 consecutive complete walks; retire nothing and alert if more than 5% would go.
- **Output when done:** Nexus always knows every DATOMS site and device
- **Now done by:** You (backend)
- **Requirement:** Innovo: show all DATOMS data
- **Depends on:** S2-02
- **External blocker:** DATOMS sample + field list (Q21, Q22) + read-only key; id stability (Q11)
- **Estimate (days):** 2
- **Acceptance check:** A new DATOMS asset appears in Nexus within 1 hour of being added to DATOMS, typed from its catalogue category (unmapped categories go to `generic` plus a to-do); assets are retired only by the safe-retire rule. New DATOMS **sites** appear only once DATOMS sends site data (Q21, Q22); until then admins create projects (S3-09). (Reworded 2026-10-14, ADR 0012.)

### S3-02 · Auto-link new sites and devices on exact match; others to admin to-do list
- **Sprint:** S3
- **Week:** W1
- **Work package:** DATOMS connector
- **Steps (how to do it):** 1. When a new DATOMS site appears, link it to a Nexus project if the name matches exactly.
  2. Otherwise add it to an 'unlinked' list for admins.
  3. Same for devices → assets.
- **Output when done:** New sites appear automatically, no guessing
- **Now done by:** You (backend)
- **Requirement:** Innovo: sites added automatically
- **Depends on:** S3-01, S3-09 (ADR 0012 link table). Exact-name matching follows the `linking.name_match` setting (off / suggest / auto, default suggest; ADR 0012).
- **Estimate (days):** 2
- **Acceptance check:** No guessed links; unmatched items listed

### S3-03 · Live sync (every minute by default): bulk endpoint → packets, latest values, statuses, locations, alerts
- **Sprint:** S3
- **Week:** W1–W2
- **Work package:** DATOMS connector
- **Steps (how to do it):** 1. Job every 60 s by default (per-type interval, ADR 0006): bulk endpoint only (ADR 0010). Fleet mode when every asset is due, otherwise id mode. In dev, only the configured subset (ADR 0005).
  2. Write telemetry.packet (history) and telemetry.latest_packet (current); status, location and alerts on change only.
  3. Insert in batches. No per-poll bookkeeping writes (asset_parameter is insert-only; status observed_at only on change).
  4. Log how long each run takes and the credits used per window.
- **Output when done:** Live DATOMS data in Nexus within about 2 poll intervals
- **Now done by:** You (backend)
- **Requirement:** Brief: real-time visibility
- **Depends on:** S3-01
- **Estimate (days):** 2
- **Acceptance check:** Value in Nexus within 2 poll intervals of DATOMS (N-03)

### S3-04 · History backfill and gap repair after outages (ON HOLD)
- **Sprint:** S3
- **Week:** W2
- **Work package:** DATOMS connector
- **Steps (how to do it):** 1. On first run, copy all past data from DATOMS (since Jul 2026 for GHAFWOODS).
  2. Record the last time synced per device.
  3. After an outage, fetch the missing time range.
  4. Test by stopping the worker for an hour.
- **Output when done:** Full history, no gaps after outages
- **Now done by:** You (backend)
- **Requirement:** Brief: trends
- **Depends on:** S3-03
- **External blocker:** ON HOLD (decided 2026-10-08). The bulk endpoint has no history (ADR 0010); Nexus builds its own history from polls from day one. Needs a DATOMS history feed (Q12) and a new ADR to use it. Until then, gaps stay gaps and charts show coverage (ADR 0007).
- **Estimate (days):** 2
- **Status:** Blocked
- **Acceptance check:** GHAFWOODS history since Jul 2026 loaded; gaps refilled after a forced outage

### S3-05 · Device linking to-do list
- **Sprint:** S3
- **Week:** W1–W2
- **Work package:** Admin console
- **Steps (how to do it):** 1. Page listing unlinked DATOMS sites/devices (from S4-02).
  2. Admin picks the project/asset to link each one to.
- **Output when done:** Admins link anything not matched automatically
- **Now done by:** Colleague (frontend)
- **Requirement:** Innovo: sites added automatically
- **Depends on:** S3-02
- **Estimate (days):** 2
- **Acceptance check:** Admin links an unmatched device to a project

### S3-06 · Integration health page: last sync, errors, delay
- **Sprint:** S3
- **Week:** W2
- **Work package:** Admin console
- **Steps (how to do it):** 1. Page showing: last successful sync time, number of errors, delay in minutes.
  2. Red warning if the sync has stopped.
- **Output when done:** Admins see if DATOMS data is flowing
- **Now done by:** Colleague (frontend)
- **Requirement:** Risks: DATOMS outage
- **Depends on:** S3-03
- **Estimate (days):** 1
- **Acceptance check:** Shows a stopped sync clearly

### S3-07 · Users and roles screen: group-to-role mapping, project assignment
- **Sprint:** S3
- **Week:** W2
- **Work package:** Admin console
- **Steps (how to do it):** 1. Page listing groups and roles (from S3-09).
  2. Assign users to projects.
  3. Show each user's role and projects.
- **Output when done:** Admins manage who sees what
- **Now done by:** Colleague (frontend)
- **Requirement:** Innovo: permissions
- **Depends on:** S2-06
- **Estimate (days):** 2
- **Acceptance check:** Admin assigns a user to a project

### S3-08 · Partition maintenance job: create future partitions, drop expired ones (critical)
- **Sprint:** S3
- **Week:** W1
- **Work package:** DATOMS connector
- **Steps (how to do it):** 1. Worker job `maintenance` (docs/07 §5), daily at 02:00 Asia/Dubai and once at start-up, leader only.
  2. Create partitions ahead for every partitioned table (raw packets, API-call log, events, audit log) using the existing SQL functions; drop partitions past retention through `drop_partitions_before` (with its audit floor).
  3. Record each run in `integration.sync_run` and raise a health warning when tomorrow's (or next month's) partition is missing.
  (Added 2026-10-14 (architect S1 plan, decision D4).)
- **Output when done:** Inserts never fail for lack of a partition; retention runs on its own
- **Now done by:** You (backend)
- **Requirement:** Foundation; N-10 retention
- **Depends on:** S1-01, S3-01 (worker scheduler and leader lock)
- **Estimate (days):** 1
- **Acceptance check:** Integration test: with the clock moved forward 40 days, every partitioned table still accepts inserts and expired partitions are gone; a missing partition raises the health warning. Merged before or with S3-03.

### S3-09 · Admin projects API (R-63): create and edit projects, assign DATOMS assets
- **Sprint:** S3
- **Week:** W2
- **Work package:** Admin console
- **Steps (how to do it):** 1. Write ADR 0012 (project source identity, link table) first.
  2. `/v1/admin/projects`: create, edit and retire projects with the admin-held fields (name, location, district, state, type, client / consultant / PM); never delete (hard rule 8).
  3. Assign DATOMS assets to projects from the linking to-do; every change goes to the audit log.
  (Added 2026-10-14 (architect S2 plan, decisions D2 and D10).)
- **Output when done:** Admins can build the portfolio until DATOMS sends site data (Q21, Q22, Q43)
- **Now done by:** You (backend)
- **Requirement:** R-63
- **Depends on:** ADR 0012 (accepted 2026-10-14), S2-06, S3-01
- **Estimate (days):** 2
- **Acceptance check:** An admin creates a project and links an asset to it; a non-admin gets 403; the change is in the audit log

### S4-01 · Chart summaries (5-minute, 1-hour, 1-day) as Nexus rollup tables

> Note (S3-08 review I6): `refresh_rollup_combine` must not run for an hour whose 5-minute rows were dropped (older than `retention.rollup_5m_days`); skip such hours. See docs/06 section 6a.
- **Sprint:** S4
- **Week:** W1
- **Work package:** Project page
- **Steps (how to do it):** 1. Use the rollup functions in db/schema.sql: telemetry.refresh_rollup_5m and refresh_rollup_combine (1 h, 1 day in Asia/Dubai).
  2. Worker rollups job (ADR 0007): refresh_rollup_5m once per CLOSED 5-minute bucket, 2 poll intervals after it ends; re-run only for closed buckets that get late packets; 1 h after the hour's last bucket; 1 d after the Dubai day. No sliding window, no in-memory accumulators.
  3. Return data coverage (packets / expectedPackets) with each bucket.
  4. Check a 30-day query returns in under 1 second.
- **Output when done:** Fast data for every chart
- **Now done by:** You (backend)
- **Requirement:** Brief: trends
- **Depends on:** S3-03
- **Estimate (days):** 1
- **Acceptance check:** 30-day chart query under 1 s

### S4-02 · Live push: status changes sent to open browsers (Web PubSub)
- **Sprint:** S4
- **Week:** W1
- **Work package:** Project page
- **Steps (how to do it):** 1. When the worker sees a status or location change, publish a slim message to Azure Web PubSub (per project group): no parameter values; values.updated hint; summary.updated; chunked well under 1 MB (docs/10, ADR 0008).
  2. API gives the browser a Web PubSub token with no group-join rights. POST /v1/live/subscriptions checks permission and scope, then joins the connection to project groups on the server.
  3. On any Nexus access change, close the affected live connections so clients re-subscribe through the scope check. Settle with the security-reviewer how the API confirms a connectionId belongs to the caller.
- **Output when done:** Changes pushed to browsers live
- **Now done by:** You (backend)
- **Requirement:** Brief: real-time visibility
- **Depends on:** S3-03
- **Estimate (days):** 2
- **Acceptance check:** Pin colour changes without refresh; a user whose project access is removed stops receiving that project's messages at once; nothing project-specific is sent to the portfolio group

### S4-03 · Project summary APIs for the equipment and energy info boxes
- **Sprint:** S4
- **Week:** W1–W2
- **Work package:** Project page
- **Steps (how to do it):** 1. Endpoints GET /projects/{id}/equipment/summary (Box 2) and GET /projects/{id}/energy/summary (Box 3), as in docs/10.
  2. Fill them from the latest DATOMS values: equipment counts from kind = 'physical' assets; energy site totals from site_metric records when DATOMS provides them. Manpower and materials are not built (slots only).
- **Output when done:** The project page loads its boxes
- **Now done by:** You (backend)
- **Requirement:** Sheet: L1 Info boxes
- **Depends on:** S3-03
- **Estimate (days):** 2
- **Acceptance check:** The two endpoints return Box 2 and Box 3 as reported; Boxes 1 and 4 are "coming later" slots

### S4-04 · Project page layout: site map, side panel, equipment and energy info boxes (space kept for manpower and materials later)
- **Sprint:** S4
- **Week:** W1
- **Work package:** Project page
- **Steps (how to do it):** 1. Project page: site map in the centre, equipment and energy info boxes on the right (as structure sheet level 1); leave space for manpower and materials.
  2. Load data from S5-03.
  3. Back button returns to the portfolio map.
- **Output when done:** Level 1 project page
- **Now done by:** Colleague (frontend)
- **Requirement:** Sheet: Level 1
- **Depends on:** S4-03
- **Estimate (days):** 2
- **Acceptance check:** Matches structure sheet level 1

### S4-05 · Asset pins: icon per type, colour per DATOMS status, clustering, map/satellite switch
- **Sprint:** S4
- **Week:** W1–W2
- **Work package:** Project page
- **Steps (how to do it):** 1. Draw one pin per equipment asset (kind = 'physical') at its DATOMS location; no location = "Not on map".
  2. Icon by type: tower crane, hoist, equipment, generator; unknown types use the generic icon.
  3. Colour by DATOMS status: Running green, Idle amber, Maintenance red, Off grey.
  4. Turn on clustering and a Map/Satellite switch. 3D uses the same icons with no callouts or pulse (ADR 0008).
- **Output when done:** Live equipment pins on the site map
- **Now done by:** Colleague (frontend)
- **Requirement:** Sheet: L1 blinkers on map
- **Depends on:** S3-03
- **External blocker:** Bulk field names for location + status (Q22; DATOMS confirmed the data is in the bulk response); blink vs pulse (Q19)
- **Estimate (days):** 2
- **Acceptance check:** Running green, Idle amber, Maintenance red, Off grey as reported

### S4-06 · Live updates on pins and boxes (WebSocket)
- **Sprint:** S4
- **Week:** W2
- **Work package:** Project page
- **Steps (how to do it):** 1. Connect to Web PubSub with the token from the API.
  2. When a message arrives, update that pin's colour and the info box numbers without reloading.
- **Output when done:** Map and boxes update live
- **Now done by:** Colleague (frontend)
- **Requirement:** Brief: real-time visibility
- **Depends on:** S4-02
- **Estimate (days):** 1
- **Acceptance check:** Update visible within a minute

### S4-07 · Asset side panel: live readings, faults, last run
- **Sprint:** S4
- **Week:** W2
- **Work package:** Project page
- **Steps (how to do it):** 1. Click a pin = side panel with the asset's latest readings, faults and last run.
  2. Link to the equipment detail page.
- **Output when done:** Asset details on click
- **Now done by:** Colleague (frontend)
- **Requirement:** DATOMS parity
- **Depends on:** S4-03
- **Estimate (days):** 1
- **Acceptance check:** Opens on pin click

### S5-01 · Energy API: generators, solar, mains, loads by area, site totals and CO2 as reported by DATOMS
- **Sprint:** S5
- **Week:** W1
- **Work package:** Energy
- **Steps (how to do it):** 1. Endpoint returning per project: generators (running/total), solar generation, mains, total load, loads by area, site totals and CO2 exactly as DATOMS gives them in the bulk response. Site totals are read from site_metric records (ADR 0009); anything missing shows "no data yet".
  2. Compare with the DATOMS Site View for GHAFWOODS; numbers must match.
- **Output when done:** Energy data for box 3 and the energy page
- **Now done by:** You (backend)
- **Requirement:** Brief: energy monitoring; Sheet: L2 Energy
- **Depends on:** S3-03
- **External blocker:** Whether DATOMS has site totals (Q3); bulk field names (Q22)
- **Estimate (days):** 3
- **Acceptance check:** Figures match DATOMS Site View for GHAFWOODS

### S5-02 · Energy equipment table data incl. owned / hired
- **Sprint:** S5
- **Week:** W1
- **Work package:** Energy
- **Steps (how to do it):** 1. Endpoint listing energy equipment: DG ID, description, type (DG/solar/mains), status, owned or hired.
  2. Ownership comes from a DATOMS field (R-31). If DATOMS lacks it, the column is hidden and reported (Q3). Nexus doesn't keep its own ownership register.
- **Output when done:** Data for the energy table
- **Now done by:** You (backend)
- **Requirement:** Sheet: L2 Energy
- **Depends on:** S5-01
- **Estimate (days):** 1
- **Acceptance check:** DG ID, description, status, ownership returned

### S5-03 · Trend endpoints: day, week, month, year from summaries
- **Sprint:** S5
- **Week:** W2
- **Work package:** Energy
- **Steps (how to do it):** 1. Endpoints for trends by day, week, month, year.
  2. Read from the rollup tables (S4-01), never raw readings for ranges over 6 h. 5-minute data only within 60 days; older ranges use hourly. Return the resolution used and data coverage per bucket.
- **Output when done:** Trend data for charts
- **Now done by:** You (backend)
- **Requirement:** Sheet: L2 trend graphs
- **Depends on:** S4-01
- **Estimate (days):** 2
- **Acceptance check:** Each range under 1 s

### S5-04 · Load-test harness: simulate 100+ sites and 1,000 users
- **Sprint:** S5
- **Week:** W2
- **Work package:** Scale
- **Steps (how to do it):** 1. Write a script (e.g. k6) that simulates 100+ sites of data and 1,000 users opening pages.
  2. Run it against dev and record response times.
- **Output when done:** Repeatable load test
- **Now done by:** You (backend)
- **Requirement:** Innovo: scalable
- **Estimate (days):** 2
- **Acceptance check:** Repeatable test script in repo

### S5-05 · Info box 3 Energy
- **Sprint:** S5
- **Week:** W1
- **Work package:** Energy
- **Steps (how to do it):** 1. Info box 3 on the project page: DGs running/total, total energy load, solar generation, main:solar ratio (structure sheet).
  2. Click = open energy detail.
- **Output when done:** Energy info box
- **Now done by:** Colleague (frontend)
- **Requirement:** Sheet: L1 Info box 3
- **Depends on:** S4-03
- **Estimate (days):** 1
- **Acceptance check:** DG running state, energy load, solar, main:solar ratio

### S5-06 · Energy detail: top ribbon of metrics
- **Sprint:** S5
- **Week:** W1
- **Work package:** Energy
- **Steps (how to do it):** 1. Top ribbon on the energy page with the key energy numbers.
  2. Data from S6-01.
- **Output when done:** Energy summary ribbon
- **Now done by:** Colleague (frontend)
- **Requirement:** Sheet: L2 Energy
- **Depends on:** S5-01
- **Estimate (days):** 1
- **Acceptance check:** Matches sheet

### S5-07 · Energy equipment table
- **Sprint:** S5
- **Week:** W1–W2
- **Work package:** Energy
- **Steps (how to do it):** 1. Table: DG ID, description, status, ownership (owned/hired), running/off.
  2. Sort and filter.
- **Output when done:** Energy equipment table
- **Now done by:** Colleague (frontend)
- **Requirement:** Sheet: L2 Energy
- **Depends on:** S5-02
- **Estimate (days):** 2
- **Acceptance check:** Sortable; status live

### S5-08 · Energy charts: load trends, distribution, solar trends
- **Sprint:** S5
- **Week:** W2
- **Work package:** Energy
- **Steps (how to do it):** 1. Charts: load trend, load distribution, solar trend.
  2. Range buttons: day, week, month, year.
  3. Data from S6-03.
- **Output when done:** Energy charts
- **Now done by:** Colleague (frontend)
- **Requirement:** Sheet: L2 Energy
- **Depends on:** S5-03
- **Estimate (days):** 3
- **Acceptance check:** Range switch day/week/month/year

### S6-01 · Equipment API: ID, name, type, make/model, status + native DATOMS fields
- **Sprint:** S6
- **Week:** W1
- **Work package:** Equipment
- **Steps (how to do it):** 1. Endpoint listing equipment per project (kind = 'physical' only): ID, name, type, make/model, current status, plus extra nameplate fields as optional columns.
  2. Every parameter DATOMS sends for a device is available from GET /assets/{id} (device card). The list endpoint carries no live values (ADR 0008).
- **Output when done:** Data for the equipment table
- **Now done by:** You (backend)
- **Requirement:** Brief: crane utilisation, asset tracking; Sheet: L2 Equipment
- **Depends on:** S3-03
- **Estimate (days):** 2
- **Acceptance check:** All DATOMS parameters available per asset

### S6-02 · Device card API: latest values, today's running timeline
- **Sprint:** S6
- **Week:** W1–W2
- **Work package:** Equipment
- **Steps (how to do it):** 1. Endpoint for one device: latest values of every parameter.
  2. Today's timeline of status changes (running, idle, off) as observed by Nexus in polls, labelled "observed by Nexus" (ADR 0007). DATOMS's own status history is used only if a later ADR adds it.
- **Output when done:** Data for the device card
- **Now done by:** You (backend)
- **Requirement:** Sheet: L2 Equipment
- **Depends on:** S6-01
- **Estimate (days):** 2
- **Acceptance check:** Timeline shows the status changes Nexus observed, labelled "observed by Nexus", accurate to one poll interval

### S6-03 · Info box 2 counts: tower cranes, hoists, all equipment (total / idle)
- **Sprint:** S6
- **Week:** W2
- **Work package:** Equipment
- **Steps (how to do it):** 1. Counts per project (kind = 'physical' only): tower cranes total/idle, hoists total/idle, all equipment total/idle, using DATOMS statuses.
  2. Add to the project summary (S5-03).
- **Output when done:** Numbers for info box 2
- **Now done by:** You (backend)
- **Requirement:** Sheet: L1 Info box 2
- **Depends on:** S6-01
- **Estimate (days):** 1
- **Acceptance check:** Counts follow DATOMS statuses

### S6-04 · Notifications from the DATOMS bulk response, and API (filter by site, asset, type)
- **Sprint:** S6
- **Week:** W2
- **Work package:** Notifications
- **Steps (how to do it):** 1. In the live poll: take DATOMS alerts and faults from the bulk response (ADR 0010; no separate events job).
  2. Store them; endpoint to list with filters: site, asset, type, date. "Mark all read" moves a read marker (docs/06 section 3, item 11).
  3. Show them exactly as DATOMS sends them.
- **Output when done:** Notifications in Nexus
- **Now done by:** You (backend)
- **Requirement:** Innovo: alerts as they come
- **Depends on:** S3-03
- **External blocker:** Alert field names in the bulk response (Q22)
- **Estimate (days):** 2
- **Acceptance check:** Same notifications as DATOMS, newest first

### S6-05 · Info box 2 component
- **Sprint:** S6
- **Week:** W1
- **Work package:** Equipment
- **Steps (how to do it):** 1. Info box 2: tower cranes count/idle, hoists count/idle, total equipment/idle (structure sheet).
  2. Click = open equipment detail.
- **Output when done:** Equipment info box
- **Now done by:** Colleague (frontend)
- **Requirement:** Sheet: L1 Info box 2
- **Depends on:** S6-03
- **Estimate (days):** 1
- **Acceptance check:** Count / idle per type

### S6-06 · Equipment detail table: sort, filter by type and status
- **Sprint:** S6
- **Week:** W1
- **Work package:** Equipment
- **Steps (how to do it):** 1. Table with Equipment ID, Name, Type, Model/Make, Current Status + extra DATOMS fields.
  2. Filter by type and status; sort; search.
- **Output when done:** Equipment detail page
- **Now done by:** Colleague (frontend)
- **Requirement:** Sheet: L2 Equipment
- **Depends on:** S6-01
- **Estimate (days):** 2
- **Acceptance check:** All sheet columns plus native fields

### S6-07 · Device card
- **Sprint:** S6
- **Week:** W2
- **Work package:** Equipment
- **Steps (how to do it):** 1. Card opened from a table row or a map pin.
  2. Shows all latest values and today's timeline.
- **Output when done:** Device card
- **Now done by:** Colleague (frontend)
- **Requirement:** Sheet: L2 Equipment
- **Depends on:** S6-02
- **Estimate (days):** 2
- **Acceptance check:** Opens from table row or pin

### S6-08 · Notifications bell and list with filters
- **Sprint:** S6
- **Week:** W2
- **Work package:** Notifications
- **Steps (how to do it):** 1. Bell in header shows unread count.
  2. Click = list of notifications, newest first, with filters.
- **Output when done:** Notifications in the header
- **Now done by:** Colleague (frontend)
- **Requirement:** Innovo: alerts as they come
- **Depends on:** S6-04
- **Estimate (days):** 2
- **Acceptance check:** Unread count; filter by site and asset

### S7-01 · Explorer API: any device, any parameter, time range, min / avg / max, compare
- **Sprint:** S7
- **Week:** W1
- **Work package:** DATOMS explorer
- **Steps (how to do it):** 1. Endpoint: for any device, list its parameters.
  2. Endpoint: values for chosen parameters and time range, with min / average / max.
  3. Works for any new parameter without code changes.
- **Output when done:** Data for 'all DATOMS data'
- **Now done by:** You (backend)
- **Requirement:** Innovo: show all DATOMS data
- **Depends on:** S4-01
- **Estimate (days):** 2
- **Acceptance check:** New parameter types appear with no code change

### S7-02 · Security hardening: private endpoints, key rotation, firewall rules, web security headers
- **Sprint:** S7
- **Week:** W2
- **Work package:** Security
- **Steps (how to do it):** 1. Put PostgreSQL and Blob behind private endpoints.
  2. Rotate keys in Key Vault.
  3. Firewall: only Container Apps can reach the database.
  4. Web app security headers and CSP (docs/08 §6) in staticwebapp.config.json: a CSP that allows only the MSAL (Entra) and ArcGIS domains plus the API and Web PubSub hosts; HSTS, X-Content-Type-Options, Referrer-Policy, frame-ancestors none. (Added by the S0 plan, 2026-10-09.)
  5. ArcGIS (security review of S0-09, PR #19, accepted by Ahmed 2026-10-14): the ArcGIS SDK puts the key in tile, style and elevation URLs (`token=`). Exclude `*.arcgis.com` and `*.arcgisonline.com` from App Insights automatic dependency tracking and strip `token=` in a telemetry initializer. CSP for the map (assets self-hosted, decision L6): `script-src 'self' 'wasm-unsafe-eval'`; `worker-src 'self' blob:`; `img-src 'self' data: blob: https://*.arcgis.com`; `connect-src` with `https://*.arcgis.com` (basemapstyles-api, ibasemaps-api, elevation3d, basemaps3d, static); `font-src 'self'`; check Calcite styles under `style-src`; no `unsafe-eval` (verify with a report-only CSP first). `Referrer-Policy: strict-origin-when-cross-origin`, never `no-referrer` (the ArcGIS key is referrer-restricted). Details in docs/09.
- **Output when done:** Data not reachable from the internet; the web app sends a CSP and security headers
- **Now done by:** You (backend)
- **Requirement:** Innovo: security
- **Estimate (days):** 2
- **Acceptance check:** Databases unreachable from internet; a header scan of the prod web URL shows the CSP and security headers, and sign-in and the map still work with the CSP on

### S7-03 · Explorer screens: site and device picker, parameter tiles, chart with ranges and compare
- **Sprint:** S7
- **Week:** W1–W2
- **Work package:** DATOMS explorer
- **Steps (how to do it):** 1. Pick site, then device.
  2. Tiles with latest value of every parameter.
  3. Click a parameter = chart with ranges (24 h, 7 days, 30 days, custom) and min/avg/max.
  4. Compare several parameters on one chart.
- **Output when done:** Explorer showing all DATOMS data
- **Now done by:** Colleague (frontend)
- **Requirement:** Innovo: show all DATOMS data
- **Depends on:** S7-01
- **Estimate (days):** 3
- **Acceptance check:** Matches DATOMS parameter view

### S7-04 · Automated permission tests for every role
- **Sprint:** S7
- **Week:** W1
- **Work package:** Hardening
- **Steps (how to do it):** 1. Create a test user for each role.
  2. Automated tests: each role can open what it should, and is refused everything else.
- **Output when done:** Permissions proven by tests
- **Now done by:** You (backend)
- **Requirement:** Innovo: permissions
- **Depends on:** S2-06
- **Estimate (days):** 2
- **Acceptance check:** Every role's allowed and denied paths covered

### S7-05 · Production environment from code
- **Sprint:** S7
- **Week:** W2
- **Work package:** Hardening
- **Steps (how to do it):** 1. Deploy 'nexus-prod' from the same Bicep files.
  2. Separate keys and Entra settings for production.
- **Output when done:** Production environment ready
- **Now done by:** You (backend)
- **Requirement:** Foundation
- **Depends on:** S0-02
- **Estimate (days):** 1
- **Acceptance check:** Prod built from the same Bicep files

### S7-06 · Tablet and mobile polish
- **Sprint:** S7
- **Week:** W1
- **Work package:** Hardening
- **Steps (how to do it):** 1. Test every screen on a phone and a tablet.
  2. Fix layouts, touch targets, drawers.
- **Output when done:** Polished tablet and mobile
- **Now done by:** Colleague (frontend)
- **Requirement:** Innovo: devices
- **Estimate (days):** 2
- **Acceptance check:** All screens usable on phone and tablet

### S7-07 · Stale and missing data states: last updated, gaps shown as gaps
- **Sprint:** S7
- **Week:** W1
- **Work package:** Hardening
- **Steps (how to do it):** 1. Show 'last updated' on every live box.
  2. Show missing data as a gap in charts, never as zero.
  3. Grey 'offline' state when DATOMS reports it.
- **Output when done:** Users can trust what they see
- **Now done by:** Colleague (frontend)
- **Requirement:** Risks: data quality
- **Estimate (days):** 2
- **Acceptance check:** No zeros shown for missing data

### S8-01 · Load test 100+ sites and 1,000 users; fix bottlenecks
- **Sprint:** S8
- **Week:** W1
- **Work package:** Hardening
- **Steps (how to do it):** 1. Run the S6-04 load test at 100+ sites and 1,000 users.
  2. Find slow endpoints; add indexes or caching.
  3. Re-run until pages load in under 2 seconds.
- **Output when done:** Proven performance at scale
- **Now done by:** You (backend)
- **Requirement:** Innovo: scalable
- **Depends on:** S5-04
- **Estimate (days):** 3
- **Acceptance check:** Pages under 2 s at target load

### S8-02 · Backups, restore test, monitoring alerts (sync stopped, error spikes)
- **Sprint:** S8
- **Week:** W2
- **Work package:** Hardening
- **Steps (how to do it):** 1. Turn on daily database backups; do one restore test.
  2. Alerts in Application Insights: sync stopped, error spike, slow responses.
- **Output when done:** Backups and alerts working
- **Now done by:** You (backend)
- **Requirement:** Risks
- **Estimate (days):** 2
- **Acceptance check:** Restore proven; alert fires on stopped sync

### S8-03 · Accessibility and performance pass
- **Sprint:** S8
- **Week:** W2
- **Work package:** Hardening
- **Steps (how to do it):** 1. Keyboard navigation and visible focus.
  2. Check contrast.
  3. Reduce bundle size; lazy-load heavy pages.
- **Output when done:** Accessible and fast
- **Now done by:** Colleague (frontend)
- **Requirement:** Quality
- **Estimate (days):** 2
- **Acceptance check:** Keyboard navigation; fast first load

### S8-04 · Report a data issue link
- **Sprint:** S8
- **Week:** W2
- **Work package:** Hardening
- **Steps (how to do it):** 1. 'Report a data issue' link on data boxes.
  2. Sends the site, asset and description to the site/technical team contact.
- **Output when done:** Data problems reach the right team
- **Now done by:** Colleague (frontend)
- **Requirement:** Risks: data quality
- **Estimate (days):** 1
- **Acceptance check:** Sends issue to site/technical team contact

### S8-05 · Penetration test and fixes
- **Sprint:** S8
- **Week:** W1
- **Work package:** Pilot
- **Steps (how to do it):** 1. Book an external penetration test.
  2. Fix all high and critical findings.
  3. Re-test.
- **Output when done:** Security signed off
- **Now done by:** You (backend)
- **Requirement:** Innovo: security
- **Depends on:** S7-05
- **External blocker:** External pen-test slot
- **Estimate (days):** 3
- **Acceptance check:** No high or critical findings open

### S8-06 · Short user guide
- **Sprint:** S8
- **Week:** W2
- **Work package:** Pilot
- **Steps (how to do it):** 1. One-page guide per role: how to find a project, read the boxes, open details.
- **Output when done:** User guide
- **Now done by:** Both
- **Requirement:** Adoption
- **Estimate (days):** 2
- **Acceptance check:** One-page guide per role

### S9-01 · Runbook and handover docs
- **Sprint:** S9
- **Week:** W2
- **Work package:** Pilot
- **Steps (how to do it):** 1. Write: how to deploy, how to restore, how to add a new data source, who to call when DATOMS is down.
- **Output when done:** Runbook so anyone can operate Nexus
- **Now done by:** You (backend)
- **Requirement:** Risks: knowledge
- **Estimate (days):** 2
- **Acceptance check:** New developer can deploy from the docs

### S9-02 · User acceptance testing on GHAFWOODS with pilot users
- **Sprint:** S9
- **Week:** W1
- **Work package:** Pilot
- **Steps (how to do it):** 1. Give pilot users access on GHAFWOODS in **prod** (there is no test environment, ADR 0008): only pilot users are assigned to the Entra app during the pilot.
  2. Walk through each screen with them.
  3. Record issues in the backlog.
- **Output when done:** Pilot feedback list
- **Now done by:** Both
- **Requirement:** Brief objectives
- **External blocker:** Pilot users' time
- **Estimate (days):** 2
- **Acceptance check:** Pilot users sign off each screen

### S9-03 · Bug fixes from pilot (backend)
- **Sprint:** S9
- **Week:** W1–W2
- **Work package:** Pilot
- **Steps (how to do it):** 1. Fix backend issues from the pilot, most important first.
- **Output when done:** Backend pilot issues closed
- **Now done by:** You (backend)
- **Depends on:** S9-02
- **Estimate (days):** 3
- **Acceptance check:** All pilot blockers fixed

### S9-04 · Bug fixes from pilot (frontend)
- **Sprint:** S9
- **Week:** W1–W2
- **Work package:** Pilot
- **Steps (how to do it):** 1. Fix frontend issues from the pilot, most important first.
- **Output when done:** Frontend pilot issues closed
- **Now done by:** Colleague (frontend)
- **Depends on:** S9-02
- **Estimate (days):** 3
- **Acceptance check:** All pilot blockers fixed

### S10-01 · Connect all DATOMS sites to production; verify auto-linking
- **Sprint:** S10
- **Week:** W1
- **Work package:** Rollout
- **Steps (how to do it):** 1. Point production at all DATOMS sites.
  2. Check every site links to the right project; clear the admin to-do list.
- **Output when done:** All sites live
- **Now done by:** You (backend)
- **Requirement:** Innovo: many sites
- **Depends on:** S9-03
- **Estimate (days):** 3
- **Acceptance check:** Every DATOMS site visible with correct project

### S10-02 · Production monitoring and cost review
- **Sprint:** S10
- **Week:** W1–W2
- **Work package:** Rollout
- **Steps (how to do it):** 1. Set Azure cost alerts.
  2. Review first month's cost and performance.
- **Output when done:** Running costs under control
- **Now done by:** You (backend)
- **Requirement:** Risks: cost
- **Estimate (days):** 2
- **Acceptance check:** Cost alerts set; first monthly review done

### S10-03 · Onboarding sessions with site teams
- **Sprint:** S10
- **Week:** W1–W2
- **Work package:** Rollout
- **Steps (how to do it):** 1. Short session per site team.
  2. Name a champion per site.
- **Output when done:** Site teams using Nexus
- **Now done by:** Both
- **Requirement:** Adoption
- **Estimate (days):** 2
- **Acceptance check:** Each site has a champion trained

### S10-04 · Phase 2 backlog grooming (reporting feed, BIM, AI)
- **Sprint:** S10
- **Week:** W2
- **Work package:** Rollout
- **Steps (how to do it):** 1. List phase 2 items (reporting feed, BIM, AI).
  2. Estimate and order them.
- **Output when done:** Phase 2 backlog ready
- **Now done by:** Both
- **Requirement:** Future
- **Estimate (days):** 1
- **Acceptance check:** Phase 2 backlog estimated

### S10-05 · UI fixes from rollout feedback
- **Sprint:** S10
- **Week:** W1–W2
- **Work package:** Rollout
- **Steps (how to do it):** 1. Fix UI feedback from rollout, most important first.
- **Output when done:** Rollout feedback closed
- **Now done by:** Colleague (frontend)
- **Estimate (days):** 3
- **Acceptance check:** Feedback items closed
