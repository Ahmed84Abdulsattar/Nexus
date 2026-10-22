# 10 · API design (REST, `/v1`)

- **Base:** `https://<host>/v1`. JSON, camelCase. Only `/health/*`, `/docs` and `/openapi.json` are outside `/v1` (`configureApp()` in `apps/api/src/common/http/configure-app.ts` sets the prefix; main.ts, the OpenAPI generator and the tests all use it, so `openapi.json` paths carry `/v1`). OpenAPI 3.1: Swagger UI at `/docs` and the spec at `/openapi.json`, both mounted only when `APP_ENV` is `local` or `dev` (an allow-list). The spec is also committed as `apps/api/openapi.json` (written by `pnpm build`), and the web client types are generated from it (see "OpenAPI and the typed client" below).
- **Browser access:** CORS answers only for the origins in `CORS_ALLOWED_ORIGINS`; every response carries helmet security headers (`08` §6). `Retry-After`, `X-Correlation-Id` and `X-Data-Lag-Seconds` are exposed to the browser.
- **Auth:** `Authorization: Bearer <Entra access token>` on everything except `/health/*`.
- **Web client:** `VITE_API_BASE_URL` ends in `/v1`; `/health/*` is called on the API origin.
- Every endpoint below lists its **permission**. *Scoped* means the project scope filter applies.

## Conventions
- **Paging:** cursor based, `?limit=50&cursor=<opaque>`. The maximum limit is 500. Responses look like `{ items: [...], nextCursor: string | null }`.
- **Filtering:** plain query params (`?state=active&district=…&q=text`). **Sorting:** `?sort=name` or `?sort=-updatedAt`.
- **Time ranges:** `?from=ISO&to=ISO` in UTC. The server picks the resolution (raw / 5m / 1h / 1d) automatically, and the client can override it with `?resolution=1h`. 5m is available only within `retention.rollup_5m_days` (60). Older ranges fall back to 1h. The response always states the `resolution` it used.
- **Coverage:** every rollup bucket returned carries `packets` (samples Nexus stored) and `expectedPackets` (bucket width × `telemetry.expected_packets_per_minute`, interim until Q12), so charts can show data coverage (ADR 0007). Nexus never fills a thin bucket.
- **Errors:** RFC 9457 `application/problem+json` `{ type, title, status, detail, correlationId }`, plus `errors: [{ path, message }]` on 422. The shape is `problemDetailsSchema` in `packages/shared` and the `ProblemDetails` component in OpenAPI; every error response uses it, including unknown routes.
  - 401: bad or missing token.
  - 403: valid token, but missing the `access_as_user` scope or the required permission.
  - 404: not found or out of project scope.
  - 422: validation (a body, query or param that fails its zod DTO). The field failures are in `errors` (at most 20; `detail` says how many were left out).
  - `detail` is fixed text for 404 (`Not found.`, so a missing id and an out-of-scope id look the same), 5xx (`Unexpected error.`) and other statuses; only 401/403/409/429 carry a specific message. The cause of a 5xx is in the server log, found by `correlationId`.
  - 413: the request body is larger than `BODY_LIMIT_BYTES` (default 1 MiB), also for chunked bodies.
  - 429: rate-limited, per client address (before authentication, for every request) or per user (the validated Entra `oid`, after authentication). Always carries `Retry-After` (seconds). The limits are in `08` §6; the counters are in memory and per API replica, not shared.
- **Freshness:** every live value carries `ts` (the source time), `receivedAt` and `stale: boolean`. `stale` uses `display.stale_after_seconds` (300 s), but never less than twice the asset type's poll interval (ADR 0006). An asset whose newest packet is older than `display.offline_after_seconds` (24 h) is also flagged offline (proposed field `offline: boolean` next to `lastPacketAt`, added with the first live-value endpoint). Both are data-freshness labels, never statuses (ADR 0013); if DATOMS states its own rule (Q8), the settings follow it. Responses that hold live data include `X-Data-Lag-Seconds`. A field the DATOMS bulk response doesn't carry is returned as absent (`null`), and the UI shows "no data yet" (ADR 0010).
- **Equipment only:** every equipment list, count and marker endpoint returns `kind = 'physical'` assets only (ADR 0009).
- **Versioning:** a breaking change goes to `/v2`. Additive fields are allowed in v1. The OpenAPI diff is checked in CI.
- **No source-specific names in the API.** Use `externalId`, not `datomsId`.
- **Decorators:** every handler has exactly one of `@RequirePermission('key')`, `@AnySignedIn()` (any valid Nexus user: `/me`, `/config`, `/live/token`, `/live/subscriptions`; the last checks permission and scope per project inside) or `@Public()` (only `/health/*`). A test fails if a handler has none.

## OpenAPI and the typed client
- **Source of truth:** controllers with zod DTOs from `packages/shared` (`createZodDto` from `nestjs-zod`; a global `ZodValidationPipe` validates input, `@ZodResponse` checks output). Never hand-write a DTO class with decorators.
- **Error responses are not repeated per handler.** `apps/api/src/openapi/setup.ts` adds them to the document: 401 and 403 on every route with the bearer requirement (set by `@RequirePermission` and `@AnySignedIn`), 404 on routes with a path parameter, 422 on routes with a body or query. `@Public` routes document none of 401/403.
- **Files:** `apps/api/openapi.json` (generated by `pnpm --filter @nexus/api build`; the API test fails if it is stale) and `apps/web/src/api/schema.d.ts` (generated by openapi-typescript). Both are committed and never edited by hand.
- **Regenerate:** `pnpm openapi:generate` (root). CI runs it and fails on `git diff --exit-code` if either file is out of date.
- **Frontend:** import `api` from `apps/web/src/api/client.ts` (openapi-fetch typed with the generated `paths`). A non-2xx answer throws `ApiError` with the parsed problem body. `setAccessTokenProvider()` is where MSAL plugs in. A changed contract that breaks a call site fails `pnpm typecheck`.

## Endpoints (phase 1)
| Method & path | Permission | Purpose | Req |
|---|---|---|---|
| GET `/me` | (any signed-in) | The caller only: `{ id, name, email, roles[], permissions[], projectScope: { all, projectIds[] } }`. `name` and `email` are as stored (null if never sent). `projectIds` is empty when `all` is true. Sorted, `Cache-Control: no-store`. Feature flags are in `/config`. | R-01–R-04 |
| GET `/config` | (any signed-in) | `{ arcgis: { apiKey, basemaps: { map2d, satellite, scene3d }, extent: { xmin, ymin, xmax, ymax }, initialView: { latitude, longitude, zoom } }, enums: { projectStates[], displayStatuses[] }, featureFlags: { key: boolean } }`. Enum entries are `{ key, label }`; display statuses come from `telemetry.status_map` (plus `unknown`), flags from `core.feature_flag`. `apiKey` is the referrer-restricted browser key from `ARCGIS_API_KEY`, `""` when not set (the web shows "Map key not configured"); it is the only credential in any response. `Cache-Control: no-store`. A test pins the key allow-list. | — |
| GET `/projects` | portfolio.read · scoped | List with filters `state, district, type, q`; includes lat/lng, state, asset counts | R-10, R-13 |
| GET `/projects/summary` | portfolio.read · scoped | Tiles: counts by state and by district | R-13 |
| GET `/projects/{projectId}` | project.read · scoped | Project details, boundary | R-20 |
| GET `/projects/{projectId}/assets` | asset.read · scoped | Equipment with live status, location, type and `lastPacketAt`; **no `latestValues`** (fetch them per asset); filters `type, category, status, q`; paged | R-21, R-30 |
| GET `/projects/{projectId}/equipment/summary` | project.read · scoped | Info box 2 counts (from `v_project_asset_counts`) | R-24 |
| GET `/projects/{projectId}/energy/summary` | project.read · scoped | Info box 3 values, as reported (DG states from equipment; site totals from `v_site_metric_live` when DATOMS provides them) | R-25 |
| GET `/projects/{projectId}/energy/assets` | asset.read · scoped | Energy equipment table | R-31 |
| GET `/projects/{projectId}/energy/trends` | telemetry.history · scoped | `?metric=&from=&to=&resolution=` | R-31, R-32 |
| GET `/assets/{assetId}` | asset.read · scoped via asset's project | Nameplate, type, status, location, latest values with parameter metadata **for this asset's source type** (ADR 0011: the same key can have a different name and unit per type; no entry = raw key, no unit) | R-23, R-33 |
| GET `/assets/{assetId}/timeline` | telemetry.history · scoped | Status changes for a day (`?date=YYYY-MM-DD`, local), with `origin: "observed"`. The UI labels it "observed by Nexus" (ADR 0007). | R-23 |
| GET `/assets/{assetId}/history` | telemetry.history · scoped | `?parameter=&from=&to=&resolution=` returns `{ resolution, points: [{ t, avg, min, max, last, packets, expectedPackets }] }` | R-32 |
| GET `/parameters` | asset.read | Parameter dictionary per source type: items `(sourceTypeName, key, displayName, unit, dataType)`, filter `?sourceTypeName=`. A key can appear once per source type with different names (ADR 0011); clients never look a name up by key alone. | R-23, R-50 |
| GET `/events` | events.read · scoped | `?projectId=&assetId=&category=&from=&to=&unread=true`, paged | R-40, R-41 |
| POST `/events/read` | events.read · scoped | `{ items: [{ eventId, occurredAt }] }` inserts `event_read` rows (occurredAt is needed because events and read state are partitioned by time). `{ all: true, projectId?, before: ISO }` moves the user's `read_marker` (global or per project) and inserts no per-event rows (`06` §3, item 11). | R-41 |
| GET `/events/unread-count` | events.read · scoped | Bell badge | R-41 |
| POST `/explorer/query` | explorer.use · scoped | `{ assetIds[], parameters[], from, to, resolution }` returns series + min/avg/max | R-50 |
| POST `/explorer/export` | explorer.export · scoped | The same body, streamed as CSV; audit-logged | R-50 |
| POST `/live/token` | (any signed-in) | Web PubSub client URL that identifies the user; **no** group-join rights (ADR 0008) | R-22 |
| POST/DELETE `/live/subscriptions` | (any signed-in) + `project.read` and scope checked per project | `{ connectionId, projectIds[] }`. The server adds or removes the connection to `project:{id}` for in-scope projects only; out-of-scope ids are dropped silently. Returns the joined ids. | R-03, R-22 |
| GET `/admin/users` | admin.users.manage | Users seen, roles, last seen | R-60 |
| GET/POST/DELETE `/admin/group-roles` | admin.users.manage | Map Entra groups to roles | R-60 |
| GET/POST/DELETE `/admin/project-access` | admin.users.manage | Grant projects to users or groups | R-60 |
| GET `/admin/integrations/health` | admin.integrations | Last runs, lag, errors, budget use per window | R-61 |
| GET `/admin/integrations/runs` | admin.integrations | `sync_run` history | R-61 |
| GET/POST `/admin/link-todo` | admin.integrations | List and resolve linking items (link to project, map type, map status label, ignore) | R-62 |
| GET/POST/PATCH `/admin/projects`, `/admin/projects/{projectId}` | admin.projects.manage | Create a project (pilot / until Q1), edit admin-held fields (name, state, coordinates, district, boundary), assign assets `{ assetIds[] }` | R-63 |
| GET/PUT `/admin/settings`, `/admin/feature-flags` | admin.settings | Settings and flags | — |
| GET `/admin/audit` | audit.read | Audit log | R-05 |
| GET `/health/live`, `/health/ready` | none | Probes (`ready` checks the DB) | — |

## Live push message format (Web PubSub, group `project:{id}`; slim, ADR 0008)
Messages carry **no parameter values**. A 250-asset site with full values would be about 0.5 MB per message every minute, and the Web PubSub message limit is 1 MB. Values are fetched from the API by the screen that needs them.

```json
{
  "type": "asset.updated",
  "projectId": "uuid",
  "at": "2026-10-07T07:01:00Z",
  "changes": [
    { "assetId": "uuid", "ts": "2026-10-07T07:00:41Z",
      "status": { "sourceValue": "Running", "display": "running" },
      "location": { "lat": 25.1, "lng": 55.2 } }
  ]
}
```
- `asset.updated` lists only assets whose **status or location changed**, with at most 200 changes per message. Larger change sets are split into several messages.
- `values.updated` `{ projectId, at }`: this poll wrote new packets for the project. An open asset panel or device card refetches `GET /assets/{id}`. Nothing else refetches.
- `summary.updated` `{ projectId, at, equipment, energy }`: info box figures changed. The two objects have the same JSON shape as `GET …/equipment/summary` and `GET …/energy/summary`.
- `event.created`: a new alert (ids, title, severity and time as reported).
- `sync.status`: data delayed or recovered. This is sent to group `portfolio` and to group `admins` (joined only by users with `admin.integrations`). It is the **only** type sent to `portfolio`, and nothing project-specific ever goes there.

A client that misses messages refetches through REST (TanStack Query invalidation on reconnect). With `LIVE_MODE=poll`, the web app refetches every 60 s instead.

## Future (reserved, do not build)
- `/v1/projects/{id}/manpower`, `/materials`, `/media`, `/weather`, `/bim`.
- `/reporting/v1/*`: a read-only service-principal API for the reporting app.
