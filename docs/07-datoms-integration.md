# 07 · DATOMS integration

**Source of truth:** `docs/source/datoms-api-v4.pdf` (DATOMS Public API v4, 16 Sep 2026), plus what DATOMS has confirmed in writing (section 3). If this file and the PDF disagree, the PDF wins unless section 3 records a newer DATOMS confirmation. Fix this file in the same PR.

**Where the code lives:** all DATOMS knowledge is in `packages/datoms-client` (URLs, field names, limits, errors). **All field mapping (DATOMS JSON → Nexus `Source*` types) lives in one file: `packages/datoms-client/src/mapping.ts`.** `packages/connectors/datoms` turns it into the generic `SourceConnector`. `apps/worker` is the only process that runs it.

**The one rule for telemetry (ADR 0010):** Nexus reads telemetry **only** from the bulk endpoint (section 2.3) and shows exactly what it returns, for **every** asset type. There are no per-type endpoints and no separate crane handling. Anything missing from a bulk row is shown as "no data yet" ("—" plus a timestamp).

## 1. Basics
| Item | Value |
|---|---|
| Base URL | `https://api.datoms.io/v4/orgs/{orgId}` |
| Auth | `Authorization: Bearer <token>`. The token is scoped to one organisation. A wrong orgId gives 403 FORBIDDEN. |
| Format | JSON. Send `Accept-Encoding: gzip` (bodies over 1 KiB are compressed). |
| Time | ISO 8601 UTC. `data.time` is the time the device reported. |
| Data rate | About 1 packet per asset per minute ("typically", per the PDF; real cadence per type is Q12). |
| Error envelope | `{ success:false, status:"failure", error:{ code, message } }` |
| Access | Read-only. Nexus never calls a write endpoint. |
| Config (env) | `DATOMS_BASE_URL`, `DATOMS_ORG_ID`, `DATOMS_TOKEN` (Key Vault in cloud), `DATOMS_LIVE` (`false` means use fixtures) |

## 2. Endpoints in v4 today
### 2.1 List assets: `GET /assets?page=&limit=`
- `limit` 1–1000 (default 20). Use **1000**. Paged with `pagination {total, page, limit, total_pages}`.
- No search, filter or sort. Order is not guaranteed between pages, so a walk can skip or repeat rows if the fleet changes during it (see the retire rules in section 6).
- Fields: `id`, `name`, `created_at`, `asset_info` (make, model, sl_no, kva, capacity, …). `id` is "currently the legacy integer id (as a string); net-new assets without a legacy id fall back to the asset UUID" (Q11).
- **Limit:** 60 requests per 60 s **per IP**.
- Errors: 401, 403, 429 (Retry-After), 502, 503.
- Used by: the catalogue sync, hourly. This is the asset list and nameplate, not telemetry.

### 2.2 Latest for one asset: `GET /assets/{assetId}/data/latest`
- Returns `{ data: { time, parameters: { key: value, … } } }`.
- **Limits per asset:** 8 per 5 min, 80 per hour, 1,500 per 24 h. Headers: `X-RateLimit-Limit/Remaining/Reset`. On a 429 the response has `Retry-After`.
- Errors: 404 `NO_DATA` (the asset hasn't reported yet) and 404 `NOT_FOUND`. Neither is a failure; record and move on.
- Used by: **only** the CLI checks in `packages/datoms-client/scripts/`. Never by the worker, the API or the browser (ADR 0010).

### 2.3 Bulk latest: `POST /assets/telemetry/latest/query` (the only telemetry source)
- **Fleet mode** `{ "page": n, "limit": 500 }` returns every asset in scope, in a fixed order, with pagination. **Use this for the full-fleet poll.**
- **Id mode** `{ "asset_ids": [...] }`: 1–500 unique ids, one row per id in request order, no pagination. Only listed in-fleet ids are charged. Use it for the per-type intervals (ADR 0006) and the non-prod subset (ADR 0005).
- Never mix the modes (that gives 400).
- A row is either `{ asset_id, success:true, data:{ time, parameters } }` or `{ asset_id, success:false }` (no usable packet, or in id mode not in the fleet).
- **What a row contains.** The v4 PDF documents the DG projection (103 parameters). **DATOMS has confirmed** that everything its portal shows is available in the bulk response: sites, generators, tower cranes, statuses, locations, asset types, alerts and all parameters (section 3). The exact field names are not known yet. They arrive with the promised sample and field list (Q21, Q22). Until then, build against the v4 PDF shape, never assume a parameter list, and keep every field name in `src/mapping.ts`.
- Not an atomic snapshot. The PDF says it "does not return events produced between polls". An alert or status that starts and ends between two polls may not be seen. Nexus shows what the bulk response contains at poll time.
- **Credit metering:** each call is charged the exact number of in-fleet rows returned. The quota is **organisation-wide**: every credential and environment in Innovo's org shares it (ADR 0005, Q10). `F` = fleet size rounded up to 500 (minimum 500). **Today's fleet is a small demo set under 500 assets, so F = 500.**

| Window | Credit cap | A 60 s full poll of N assets uses | OK? |
|---|---|---|---|
| 1 min | 4F | N | yes (≤ 25% of the cap) |
| 5 min | 8F | 5N | yes (≤ 62.5%) |
| 1 hour | 100F | 60N | yes (≤ 60%) |
| 24 h rolling | 2,500F | 1,440N | yes (≤ 58%) |
| 30 days rolling | 60,000F | 43,200N | yes (≤ 72%) |

  These percentages are for **one** environment polling the full fleet. A second full-fleet poller in the same org would exceed the 5 min, 1 h, 24 h and 30-day caps when N = F. That is why only prod polls the full fleet (ADR 0005).
  The request limit is 240 per 60 s per credential and organisation. A 20,000-asset fleet needs 40 pages per poll at 500 rows. If 422 halving drops pages to 125 rows, that is 160 requests (see section 4, item 10, and Q13).
- Headers: `X-RateLimit-Unit` (`asset-read-credits` or `requests`), then `X-RateLimit-Limit/Remaining/Reset`. **Read the Unit first.**
- **422 `PAGE_RESPONSE_TOO_LARGE`:** do not retry the same request. The credits are refunded. Then:
  `new_limit = max(1, floor(old_limit/2))`, `resume_page = floor(((old_page-1)*old_limit)/new_limit)+1`. In id mode, split the list in two.
- Other errors: 400 VALIDATION_ERROR (a bug, so alert), 401/403 (config, so alert and stop), 429 (wait `Retry-After`), 502/503/504 (backoff).

> The Innovo contract also has a **monthly credit allowance** for the subscription tier. The budget tracker must take `DATOMS_MONTHLY_CREDIT_ALLOWANCE` as config and warn at 80% use. Example: 250 assets × 43,200 polls ≈ 10.8 M credits a month. 500 assets ≈ 21.6 M, which is above a 15 M allowance, and 20,000 assets ≈ 864 M. Ask the business owner before increasing the fleet or the poll rate (Q5, Q14). Per-type intervals (ADR 0006) are the lever if the allowance is lower.

## 3. Confirmed by DATOMS, waiting for field names
DATOMS has confirmed that **everything visible in its portal is in the bulk response** (Q9, answered). DATOMS has promised:
- **(Q21)** a real sample bulk response. When it arrives, save it to `packages/datoms-client/fixtures/` with tokens and headers removed.
- **(Q22)** an updated API document listing the bulk fields for sites, status, location, asset type and alerts.

Both are needed **before S2-02** (DATOMS client). They do **not** block S0 or S1. Until they arrive, the matching Nexus field stays empty and the UI shows "no data yet". When they arrive, only `src/mapping.ts`, its tests and the fixtures change.

| Needed for | In the bulk response (field names pending Q21/Q22) | Nexus target |
|---|---|---|
| Portfolio map | Site with coordinates, state, district | `core.project` |
| Asset placement | Asset → site link, asset location (lat/lng), asset type | `core.asset.project_id`, `asset_location_current`, `asset_type` |
| Status colours | Asset status (Running / Idle / Maintenance / Off) as shown in the portal | `asset_status_current`, `status_map` |
| Alerts | Alerts / notifications with time, severity, asset | `events.event` |
| Energy box | Site totals (load, solar, mains ratio), if the portal shows them (Q3) | `latest_packet` of a `kind = 'site_metric'` asset (ADR 0009) |
| Parameter metadata | Display names, units, categories | `telemetry.parameter` |
| Trends after downtime | History per asset and time range | **Not in the bulk endpoint.** On hold: a history feed needs a new ADR (see ADR 0010, Consequences). |
| Real-time < 60 s | WebSocket / MQTT / webhooks (Q6) | New ingest path (ADR); screens unchanged |

## 4. Client behaviour (must be implemented and unit-tested)
1. **Paging walker.** Loop pages until `page >= total_pages`. Process and release each page before fetching the next.
2. **Budget tracker.** Keep sliding windows (1 m, 5 m, 1 h, 24 h, 30 d) of credits spent and requests made. Each cap is multiplied by setting `budget.max_share` (ADR 0005; prod 1.0, dev small). Before each call, estimate its cost (`min(limit, remaining assets)` in fleet mode, the number of ids in id mode) and **wait or skip** if it would go past 90% of any cap. After each call, use the server's headers as the truth. The quota is shared with every other consumer in the org, so never assume Nexus is the only one. Persist each call to `integration.api_call` so a restart doesn't forget usage.
3. **Adaptive interval.** Use each asset type's interval (`asset_type.poll_interval_seconds`, otherwise `poll.interval_seconds` = 60). If any window passes 80%, multiply every interval by 2, then by 5, and log a warning. Return to normal when the window clears.
4. **Retries.** 429 waits `Retry-After`. 5xx and network errors back off with jitter (1 s, 2 s, 4 s, 8 s, maximum 5 tries). 401/403/400 never retry; alert instead.
5. **Timeouts.** 30 s per request. The whole poll must finish within the interval; if not, skip the next tick (no overlap).
6. **Change detection.** Write a packet only if `data.time` is newer than `latest_packet.ts` for that asset.
7. **Mapping.** All of it is in `src/mapping.ts`. It turns raw DATOMS rows into `SourceReading { externalAssetId, ts, values }` plus, when present in the row, status, location, asset type, site link, kind (`equipment` / `site_metric`) and alerts. Keys and values pass through unchanged. Unknown keys are recorded in `telemetry.parameter`. A missing field maps to "absent", never to a default value.
8. **Logging.** For each call log the endpoint, mode, page, HTTP status, duration, credits, rate-limit headers and correlation id. Never log the token.
9. **Fixtures.** `scripts/record.ts` saves real responses (no headers or tokens) into `fixtures/`. Tests and local dev use fixtures. `DATOMS_LIVE=true` is needed to call DATOMS. Live CLI runs use id mode with a short list by default; fleet mode against live DATOMS needs an explicit `--fleet` flag (ADR 0005).
10. **Learned page size.** After a 422, keep the smaller page size in `integration.cursor` (`job = 'live_poll'`, `value.pageLimit`) so the next poll starts with it. Try 500 again once a day.
11. **Poll scope.** If `poll.subset_external_ids` is a list, poll only those ids in id mode (non-prod, ADR 0005). If it is `null`, plan each tick from the per-type intervals: use fleet mode when every asset is due, otherwise id mode for the due ids (ADR 0006).

## 5. Worker jobs
| Job | Schedule | Steps |
|---|---|---|
| `catalogue-sync` | On start, then hourly, plus early when the poll sees unknown ids (at most once per 5 min) | listAssets (all pages; names and nameplate) → upsert assets → retire safely (section 6) → `sync_run`. Spends no bulk credits. |
| `live-poll` | Every 60 s by default (per-type and adaptive), leader only | budget check → bulk pages (fleet or id mode) → upsert sites, asset types and parameter keys found in the rows (new ones go to `link_todo` / `telemetry.parameter`) → change detection → write packets, latest values, status, location and alerts (`events.event`) → publish slim messages to Web PubSub per project (`10-api-design.md`) → `sync_run` (lag = now − newest ts) |
| `history-backfill` | **On hold** | Needs a DATOMS history feed and a new ADR (ADR 0010). Not built in phase 1 until decided. |
| `rollups` (ADR 0007) | 5 min: each closed bucket, at bucket end + `rollup.close_grace_intervals` (2) × the current poll interval. 1 h: right after the hour's last 5-min bucket. 1 d: after the Dubai day's last hour (about midnight + 10 min). | SQL only: `refresh_rollup_5m(bucket_start, bucket_end)` once per closed bucket, and again only for closed buckets that got late packets (the poll records the oldest `ts` it wrote). `refresh_rollup_combine` for 1 h and 1 d in batches of 1,000 assets. No sliding window, no per-minute refresh, no in-memory accumulators (that is a scale trigger in `12` §2). |
| `maintenance` | Daily 02:00 Asia/Dubai | Partitions ahead, retention drops, `api_call` cleanup. Archive to Blob deferred (ADR 0008). |

There is no separate `events-sync` job: alerts come in the bulk response (ADR 0010).

**Leader election:** `SELECT pg_try_advisory_lock(hashtext('nexus-worker-leader'))` on a dedicated connection. Only the holder runs DATOMS jobs. Check the lock connection before each job; if it was lost (for example after a database failover), stop and try to take the lock again. This keeps the worker safe if two replicas ever start.

## 6. Linking new sites and assets automatically
- **Until the bulk site fields are mapped (Q21, Q22):** projects are created by an admin (R-63, `/admin/projects`), and DATOMS assets are assigned to them from the linking to-do. The worker never invents a project.
- **Once site fields are mapped:** a new DATOMS site creates a `core.project` with `state` from the source (or `unknown`). It is visible to `all_projects` roles at once, and to others once an admin grants access.
- A new asset is linked to its project by the DATOMS site id. If the site is unknown it gets `project_id = null` and a `link_todo` row.
- A new asset type name is set to `generic` with a `link_todo`; once an admin maps it, the icon changes.
- A new status label gets display `unknown` with a `link_todo`.
- **Retire safely.** An asset (or, later, a site) is retired only after a **complete** catalogue walk where the number seen equals `pagination.total`, and only if it was missing from `catalogue.retire_after_misses` (2) consecutive complete walks. If one sync would retire more than `catalogue.retire_max_fraction` (5%) of active assets, it retires nothing and raises an alert. Retired rows keep their history (`retired_at`, never delete).
- **Unknown ids in the poll.** Bulk rows for ids the catalogue doesn't know yet are skipped, counted in `sync_run`, and trigger an early catalogue sync.
- **Id stability.** If DATOMS ever changes an asset's id (legacy integer → UUID, Q11), the asset would look new and the old one would be retired. Until Q11 is answered, an admin can relink history through the linking to-do.
- **No code change is ever needed for growth.**

## 7. Contract tests (`tests/contract/`)
Run nightly against the live API (read-only), and by hand when DATOMS announces a change. They use **id mode with a few ids** so they spend almost no credits (ADR 0005). They check:
- Response shapes (zod) for each endpoint.
- Pagination totals.
- That the rate-limit headers are present.
- That 422 handling works on a forced small limit.
- That fixtures still match the live shape. If not, the build fails with a diff.
