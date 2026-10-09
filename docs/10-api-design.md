# 10 · API design (REST, `/v1`)

- **Base:** `https://<host>/v1`. JSON, camelCase. OpenAPI 3.1 at `/docs` (the Swagger UI is turned off in prod) and `/openapi.json`.
- **Auth:** `Authorization: Bearer <Entra access token>` on everything except `/health/*`.
- Every endpoint below lists its **permission**. *Scoped* means the project scope filter applies.

## Conventions
- **Paging:** cursor based, `?limit=50&cursor=<opaque>`. The maximum limit is 500. Responses look like `{ items: [...], nextCursor: string | null }`.
- **Filtering:** plain query params (`?state=active&district=…&q=text`). **Sorting:** `?sort=name` or `?sort=-updatedAt`.
- **Time ranges:** `?from=ISO&to=ISO` in UTC. The server picks the resolution (raw / 5m / 1h / 1d) automatically, and the client can override it with `?resolution=1h`. 5m is available only within `retention.rollup_5m_days` (60). Older ranges fall back to 1h. The response always states the `resolution` it used.
- **Coverage:** every rollup bucket returned carries `packets` (samples Nexus stored) and `expectedPackets` (bucket width × `telemetry.expected_packets_per_minute`, interim until Q12), so charts can show data coverage (ADR 0007). Nexus never fills a thin bucket.
- **Errors:** RFC 7807 `application/problem+json` `{ type, title, status, detail, correlationId }`.
  - 401: bad or missing token.
  - 403: missing permission.
  - 404: not found or out of scope.
  - 422: validation.
  - 429: rate-limited.
- **Freshness:** every live value carries `ts` (the source time), `receivedAt` and `stale: boolean`. `stale` uses the DATOMS rule when known; otherwise it uses the interim `display.stale_after_seconds`, but never less than twice the asset type's poll interval (Q8, ADR 0006). Responses that hold live data include `X-Data-Lag-Seconds`. A field the DATOMS bulk response doesn't carry is returned as absent (`null`), and the UI shows "no data yet" (ADR 0010).
- **Equipment only:** every equipment list, count and marker endpoint returns `kind = 'physical'` assets only (ADR 0009).
- **Versioning:** a breaking change goes to `/v2`. Additive fields are allowed in v1. The OpenAPI diff is checked in CI.
- **No source-specific names in the API.** Use `externalId`, not `datomsId`.
- **Decorators:** every handler has exactly one of `@RequirePermission('key')`, `@AnySignedIn()` (any valid Nexus user: `/me`, `/config`, `/live/token`, `/live/subscriptions`; the last checks permission and scope per project inside) or `@Public()` (only `/health/*`). A test fails if a handler has none.

## Endpoints (phase 1)
| Method & path | Permission | Purpose | Req |
|---|---|---|---|
| GET `/me` | (any signed-in) | User, roles, permissions, feature flags | R-01–R-04 |
| GET `/config` | (any) | ArcGIS key and settings, enums (project states, display statuses), feature flags | — |
| GET `/projects` | portfolio.read · scoped | List with filters `state, district, type, q`; includes lat/lng, state, asset counts | R-10, R-13 |
| GET `/projects/summary` | portfolio.read · scoped | Tiles: counts by state and by district | R-13 |
| GET `/projects/{projectId}` | project.read · scoped | Project details, boundary | R-20 |
| GET `/projects/{projectId}/assets` | asset.read · scoped | Equipment with live status, location, type and `lastPacketAt`; **no `latestValues`** (fetch them per asset); filters `type, category, status, q`; paged | R-21, R-30 |
| GET `/projects/{projectId}/equipment/summary` | project.read · scoped | Info box 2 counts (from `v_project_asset_counts`) | R-24 |
| GET `/projects/{projectId}/energy/summary` | project.read · scoped | Info box 3 values, as reported (DG states from equipment; site totals from `v_site_metric_live` when DATOMS provides them) | R-25 |
| GET `/projects/{projectId}/energy/assets` | asset.read · scoped | Energy equipment table | R-31 |
| GET `/projects/{projectId}/energy/trends` | telemetry.history · scoped | `?metric=&from=&to=&resolution=` | R-31, R-32 |
| GET `/assets/{assetId}` | asset.read · scoped via asset's project | Nameplate, type, status, location, latest values with parameter metadata | R-23, R-33 |
| GET `/assets/{assetId}/timeline` | telemetry.history · scoped | Status changes for a day (`?date=YYYY-MM-DD`, local), with `origin: "observed"`. The UI labels it "observed by Nexus" (ADR 0007). | R-23 |
| GET `/assets/{assetId}/history` | telemetry.history · scoped | `?parameter=&from=&to=&resolution=` returns `{ resolution, points: [{ t, avg, min, max, last, packets, expectedPackets }] }` | R-32 |
| GET `/parameters` | asset.read | Parameter dictionary (key, displayName, unit, dataType) | R-23 |
| GET `/events` | events.read · scoped | `?projectId=&assetId=&category=&from=&to=&unread=true`, paged | R-40, R-41 |
| POST `/events/read` | events.read · scoped | `{ items: [{ eventId, occurredAt }] }` inserts `event_read` rows (occurredAt is needed because events and read state are partitioned by time). `{ all: true, projectId?, before: ISO }` moves the user's `read_marker` (global or per project) and inserts no per-event rows (`06` §3, item 11). | R-41 |
| GET `/events/unread-count` | events.read · scoped | Bell badge | R-41 |
| POST `/explorer/query` | explorer.use · scoped | `{ assetIds[], parameters[], from, to, resolution }` returns series + min/avg/max | R-50 |
| POST `/explorer/export` | explorer.export · scoped | The same body, streamed as CSV; audit-logged | R-50 |
| POST `/live/token` | (any) | Web PubSub client URL that identifies the user; **no** group-join rights (ADR 0008) | R-22 |
| POST/DELETE `/live/subscriptions` | (any) + `project.read` and scope checked per project | `{ connectionId, projectIds[] }`. The server adds or removes the connection to `project:{id}` for in-scope projects only; out-of-scope ids are dropped silently. Returns the joined ids. | R-03, R-22 |
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
