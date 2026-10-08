# 07 · DATOMS integration

**Source of truth:** `docs/source/datoms-api-v4.pdf` (DATOMS Public API v4, 16 Sep 2026). If this file and the PDF disagree, the PDF wins. Fix this file in the same PR.

**Where the code lives:** all DATOMS knowledge is in `packages/datoms-client` (URLs, field names, limits, errors). `packages/connectors/datoms` turns it into the generic `SourceConnector`. `apps/worker` is the only process that runs it.

## 1. Basics
| Item | Value |
|---|---|
| Base URL | `https://api.datoms.io/v4/orgs/{orgId}` |
| Auth | `Authorization: Bearer <token>`. The token is scoped to one organisation. A wrong orgId gives 403 FORBIDDEN. |
| Format | JSON. Send `Accept-Encoding: gzip` (bodies over 1 KiB are compressed). |
| Time | ISO 8601 UTC. `data.time` is the time the device reported. |
| Data rate | About 1 packet per asset per minute. |
| Error envelope | `{ success:false, status:"failure", error:{ code, message } }` |
| Access | Read-only. Nexus never calls a write endpoint. |
| Config (env) | `DATOMS_BASE_URL`, `DATOMS_ORG_ID`, `DATOMS_TOKEN` (Key Vault in cloud), `DATOMS_LIVE` (`false` means use fixtures) |

## 2. Endpoints in v4 today
### 2.1 List assets: `GET /assets?page=&limit=`
- `limit` 1–1000 (default 20). Use **1000**. Paged with `pagination {total, page, limit, total_pages}`.
- No search, filter or sort.
- Fields: `id`, `name`, `created_at`, `asset_info` (make, model, sl_no, kva, capacity, …).
- **Limit:** 60 requests per 60 s **per IP**.
- Errors: 401, 403, 429 (Retry-After), 502, 503.
- Used by: the catalogue sync, hourly.

### 2.2 Latest for one asset: `GET /assets/{assetId}/data/latest`
- Returns `{ data: { time, parameters: { key: value, … } } }`.
- **Limits per asset:** 8 per 5 min, 80 per hour, 1,500 per 24 h. Headers: `X-RateLimit-Limit/Remaining/Reset`. On a 429 the response has `Retry-After`.
- Errors: 404 `NO_DATA` (the asset hasn't reported yet) and 404 `NOT_FOUND`. Neither is a failure; record and move on.
- Used by: **only** the CLI scripts for checks. Never in the poll loop, and never by the API.

### 2.3 Bulk latest: `POST /assets/telemetry/latest/query`
- **Fleet mode** `{ "page": n, "limit": 500 }` returns every asset in scope, in a fixed order, with pagination. **Use this for the 60 s poll.**
- **Id mode** `{ "asset_ids": [...] }`: 1–500 unique ids, one row per id in request order, no pagination. Use it for targeted refreshes.
- Never mix the modes (that gives 400).
- A row is either `{ asset_id, success:true, data:{ time, parameters } }` or `{ asset_id, success:false }` (no usable packet, or in id mode not in the fleet).
- Successful rows currently contain the **DG projection, 103 parameters**. Other asset types will add other parameter sets, so never assume this list.
- Not an atomic snapshot, and it does not return events that happened between polls.
- **Credit metering:** each call is charged the exact number of in-fleet rows returned. `F` = fleet size rounded up to 500 (minimum 500).

| Window | Credit cap | A 60 s full poll of N assets uses | OK? |
|---|---|---|---|
| 1 min | 4F | N | yes (≤ 25% of the cap) |
| 5 min | 8F | 5N | yes (≤ 62.5%) |
| 1 hour | 100F | 60N | yes (≤ 60%) |
| 24 h rolling | 2,500F | 1,440N | yes (≤ 58%) |
| 30 days rolling | 60,000F | 43,200N | yes (≤ 72%) |

  The request limit is 240 per 60 s per credential and organisation. A 20,000-asset fleet needs 40 pages per poll, which is fine.
- Headers: `X-RateLimit-Unit` (`asset-read-credits` or `requests`), then `X-RateLimit-Limit/Remaining/Reset`. **Read the Unit first.**
- **422 `PAGE_RESPONSE_TOO_LARGE`:** do not retry the same request. The credits are refunded. Then:
  `new_limit = max(1, floor(old_limit/2))`, `resume_page = floor(((old_page-1)*old_limit)/new_limit)+1`. In id mode, split the list in two.
- Other errors: 400 VALIDATION_ERROR (a bug, so alert), 401/403 (config, so alert and stop), 429 (wait `Retry-After`), 502/503/504 (backoff).

> The Innovo contract also has a **monthly credit allowance** for the subscription tier. The budget tracker must take `DATOMS_MONTHLY_CREDIT_ALLOWANCE` as config and warn at 80% use. Example: 250 assets × 43,200 polls ≈ 10.8 M credits a month. 500 assets ≈ 21.6 M, which is above a 15 M allowance. Ask the business owner before increasing the fleet or the poll rate.

## 3. Expected next (DATOMS confirmed "everything in the portal is available by API")
Add each of these inside `datoms-client` when its docs arrive. Until then, the matching Nexus field stays empty and the UI shows "not available yet".

| Needed for | Expected endpoint / field | Nexus target |
|---|---|---|
| Portfolio map | Sites / territories with coordinates, state, district | `core.project` |
| Asset placement | Asset → site link, asset location (lat/lng), asset type | `core.asset.project_id`, `asset_location_current`, `asset_type` |
| Status colours | Asset status (Running / Idle / Maintenance / Off) as shown in the portal | `asset_status_current`, `status_map` |
| Alerts | Events / notifications with time, severity, asset | `events.event` |
| Trends after downtime | History per asset and time range | `telemetry.packet` backfill |
| Energy box | Site totals (load, solar, mains ratio) if the portal computes them | `latest_packet` of a site-level virtual asset, or `project` metrics |
| Parameter metadata | Display names, units, categories | `telemetry.parameter` |
| Real-time < 60 s | WebSocket / MQTT / webhooks | New ingest path (ADR); screens unchanged |

## 4. Client behaviour (must be implemented and unit-tested)
1. **Paging walker.** Loop pages until `page >= total_pages`. Process and release each page before fetching the next.
2. **Budget tracker.** Keep sliding windows (1 m, 5 m, 1 h, 24 h, 30 d) of credits spent and requests made. Before each call, estimate its cost (`min(limit, remaining assets)`) and **wait or skip** if it would go past 90% of any cap. After each call, use the server's headers as the truth. Persist each call to `integration.api_call` so a restart doesn't forget usage.
3. **Adaptive interval.** Use the normal 60 s. If any window passes 80%, slow to 120 s, then 300 s, and log a warning. Return to normal when the window clears.
4. **Retries.** 429 waits `Retry-After`. 5xx and network errors back off with jitter (1 s, 2 s, 4 s, 8 s, maximum 5 tries). 401/403/400 never retry; alert instead.
5. **Timeouts.** 30 s per request. The whole poll must finish within the interval; if not, skip the next tick (no overlap).
6. **Change detection.** Write a packet only if `data.time` is newer than `latest_packet.ts` for that asset.
7. **Mapping.** Turn raw DATOMS rows into `SourceReading { externalAssetId, ts, values }`. Keys and values pass through unchanged. Unknown keys are recorded in `telemetry.parameter`.
8. **Logging.** For each call log the endpoint, page, HTTP status, duration, credits, rate-limit headers and correlation id. Never log the token.
9. **Fixtures.** `scripts/record.ts` saves real responses (no headers or tokens) into `fixtures/`. Tests and local dev use fixtures. `DATOMS_LIVE=true` is needed to call DATOMS.

## 5. Worker jobs
| Job | Schedule | Steps |
|---|---|---|
| `catalogue-sync` | On start, then hourly | listAssets (all pages) → upsert assets → retire missing → new types and sites go to `link_todo` → `sync_run` |
| `live-poll` | Every 60 s (adaptive), leader only | budget check → bulk fleet pages → change detection → write packets, latest, status, location → publish to Web PubSub per project → `sync_run` (lag = now − newest ts) |
| `events-sync` | Every 60 s, once the endpoint exists | Read events since the cursor → upsert → publish |
| `history-backfill` | After downtime, once the endpoint exists | For gaps over 5 min, fetch history in small chunks within the budget |
| `rollups` | 5 min: in memory in `live-poll`, upserted when each bucket closes. 1 h: at each hour close + 2 min. 1 d: at Dubai midnight + 10 min. | In-memory accumulators per asset (min/max/sum/count/last per numeric key). On start, rebuild the open bucket with `refresh_rollup_5m`. For late packets, re-run `refresh_rollup_5m` for the affected buckets only. Hourly and daily combines run in batches of 1,000 assets (see `06-database.md` sections 4 and 6). |
| `maintenance` | Daily 02:00 Asia/Dubai | Partitions ahead, retention drops, `api_call` cleanup |

**Leader election:** `SELECT pg_try_advisory_lock(hashtext('nexus-worker-leader'))` on a dedicated connection. Only the holder runs DATOMS jobs. This keeps the worker safe if two replicas ever start.

## 6. Linking new sites and assets automatically
- **Until DATOMS site endpoints exist (Q1):** projects are created by an admin (R-63, `/admin/projects`), and DATOMS assets are assigned to them from the linking to-do. The worker never invents a project.
- **Once site endpoints exist:** a new DATOMS site creates a `core.project` with `state` from the source (or `unknown`). It is visible to `all_projects` roles at once, and to others once an admin grants access.
- A new asset is linked to its project by the DATOMS site id. If the site is unknown it gets `project_id = null` and a `link_todo` row.
- A new asset type name is set to `generic` with a `link_todo`; once an admin maps it, the icon changes.
- A new status label gets display `unknown` with a `link_todo`.
- **No code change is ever needed for growth.**

## 7. Contract tests (`tests/contract/`)
Run nightly against the live API (read-only), and by hand when DATOMS announces a change. They check:
- Response shapes (zod) for each endpoint.
- Pagination totals.
- That the rate-limit headers are present.
- That 422 handling works on a forced small limit.
- That fixtures still match the live shape. If not, the build fails with a diff.
