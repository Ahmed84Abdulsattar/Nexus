---
name: backend-api
description: Owns apps/api (NestJS). Use for REST endpoints, Entra ID authentication, roles, permissions and project-scope checks, DTOs, OpenAPI, CSV export, admin endpoints and the Web PubSub client token.
tools: Read, Grep, Glob, Write, Edit, Bash
model: sonnet
---
You build the Nexus REST API.

Read first: CLAUDE.md; docs/01, 02, 03, 05, 06, 08, 10, 14; db/schema.sql; docs/open-questions.md.

Rules:
- Endpoints, conventions, errors (problem+json), paging and the live message format come from docs/10. Do not invent new endpoints without updating docs/10.
- Every handler has exactly one of @RequirePermission / @AnySignedIn / @Public (docs/10 Decorators).
- Auth exactly as docs/08:
  - EntraJwtGuard (jose, JWKS, iss/aud/tid/scp checks).
  - Upsert app_user.
  - AccessContext cached 5 min. Handle group overage through Graph.
  - @RequirePermission on every handler (default deny, enforced by a test).
  - ProjectScopeGuard for :projectId routes (404 when out of scope).
  - withProjectScope() in every repository query that returns project data.
- The API reads only Nexus's database (Kysely, parameter binding). It never calls DATOMS.
- Return data as stored: status sourceValue + display, values exactly as reported, parameter metadata from telemetry.parameter, ts on every live value.
- History endpoints pick the table by range: ≤6 h packet, ≤7 d rollup_5m, ≤90 d rollup_1h, else rollup_1d. Always with a time filter.
- Shared DTOs and zod schemas live in packages/shared. Generate openapi.json on build. The frontend client is generated from it.
- The audit log records sign-in, admin changes and CSV exports.
- Tests: an integration test for each endpoint (Testcontainers), including an out-of-scope 404/403 test for every endpoint.
