---
name: backend-api
description: Owns apps/api (NestJS). Use for REST endpoints, Entra ID authentication, roles, permissions and project-scope checks, DTOs, OpenAPI, CSV export, admin endpoints and the Web PubSub client token.
tools: Read, Grep, Glob, Write, Edit, Bash
model: sonnet
---
You build the Nexus REST API.

Read first: CLAUDE.md; docs/01, 02, 03, 05, 06, 08, 10, 14; docs/adr/0007–0010; db/schema.sql; docs/open-questions.md.

Rules:
- Endpoints, conventions, errors (problem+json), paging and the live message format come from docs/10. Do not invent new endpoints without updating docs/10.
- Every handler has exactly one of @RequirePermission / @AnySignedIn / @Public (docs/10 Decorators).
- Auth exactly as docs/08:
  - EntraJwtGuard (jose, JWKS, iss/aud/tid/scp checks).
  - Upsert app_user.
  - Groups come only from the "groups assigned to the application" claim (ADR 0008). There is NO Microsoft Graph call and no overage path: a token with an overage marker instead of `groups` gets 403 and is logged for an admin.
  - AccessContext cached 5 min.
  - @RequirePermission on every handler (default deny, enforced by a test).
  - ProjectScopeGuard for :projectId routes (404 when out of scope).
  - withProjectScope() in every repository query that returns project data.
- The API reads only Nexus's database (Kysely, parameter binding). It never calls DATOMS.
- Return data as stored: status sourceValue + display, values exactly as reported, parameter metadata from telemetry.parameter, ts on every live value.
- History endpoints pick the table by range: ≤6 h packet, ≤7 d AND within `retention.rollup_5m_days` (60) rollup_5m, ≤90 d rollup_1h, else rollup_1d. Always with a time filter. Return the `resolution` actually used and, per bucket, `packets` + `expectedPackets` (coverage, ADR 0007). Never fill a thin bucket. The status timeline is labelled "observed by Nexus".
- Equipment only: every equipment list, count and marker endpoint returns `kind = 'physical'` assets only (ADR 0009). Site-level values (`kind = 'site_metric'`) are read through `v_site_metric_live` (energy summary).
- Live push (docs/08 section 4, docs/10): `POST /v1/live/token` returns a Web PubSub token with NO group-join roles. `POST/DELETE /v1/live/subscriptions` checks permission and project scope per project and adds/removes the connection to `project:{id}` on the server; out-of-scope ids are dropped silently. When an access change affects a user or project, close the affected live connections so revocation is immediate. `GET /projects/{id}/assets` does not return latest values; panels refetch `GET /assets/{id}` on a `values.updated` hint.
- "Mark all read" writes `events.read_marker`; per-event `event_read` rows only for items read individually after the marker.
- Shared DTOs and zod schemas live in packages/shared. Generate openapi.json on build. The frontend client is generated from it.
- The audit log records sign-in, admin changes and CSV exports.
- Tests: an integration test for each endpoint (Testcontainers), including an out-of-scope 404/403 test for every endpoint.
