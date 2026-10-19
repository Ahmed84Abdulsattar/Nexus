# 07 · DATOMS integration

**Source of truth:** `docs/source/datoms-api-v4.pdf` (DATOMS Public API v4, 16 Sep 2026), the DATOMS parameter list `docs/source/datoms-parameters.md` (copy of `datoms-parameters.xlsx`, 12 Oct 2026), plus what DATOMS has confirmed in writing (section 3). If this file and the PDF disagree, the PDF wins unless section 3 records a newer DATOMS confirmation. Fix this file in the same PR.

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
| Organisation | Innovo's org id is `20283` (a public identifier, not a secret). Set it as `DATOMS_ORG_ID`. |
| Config (env) | `DATOMS_BASE_URL`, `DATOMS_ORG_ID`, `DATOMS_TOKEN` (Key Vault in cloud; the provisional test key is only in a developer's local `.env`, section 3.1), `DATOMS_LIVE` (`false` means use fixtures) | `DATOMS_BASE_URL` must be `https://api.datoms.io/...` (no other host, port, credentials, query or fragment; the client refuses anything else). The token is never part of JSON, logs or `util.inspect` output.

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
- **What a row contains.** The v4 PDF documents the DG projection (103 parameters). **DATOMS has confirmed** that everything its portal shows is available in the bulk response: sites, generators, tower cranes, statuses, locations, asset types, alerts and all parameters (section 3). The parameter **keys, names and units** for four asset categories are now known from the DATOMS parameter list (section 3.2). The field names for sites, status, location, asset type and alerts are not known yet. They arrive with the promised sample and field list (Q21, Q22). Until then, build against the v4 PDF shape, never assume a parameter list in code (the list is data: `telemetry.parameter`), and keep every field name in `src/mapping.ts`.
- **Is it enabled for our key?** Yes, checked 2026-10-12 (Q34, section 3.3).
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

## 3. What DATOMS has given, and what is still pending

### 3.1 Provisional test key (received 12 Oct 2026)
> **The test key expires on 10 Nov 2026. Live S3-03 testing must finish before then. Ahmed requests the production key from DATOMS by 1 Nov 2026 (Q7).**

| Item | Value |
|---|---|
| Organisation | `20283`, Innovo's org, on **live** data |
| Access | Read-only and provisional. Valid until **10 Nov 2026**. After that DATOMS will refuse it (401), and the client alerts and stops (section 2.3). What replaces it, for dev and for prod, is Q7. |
| Quota and limits | Calls with this key do **not** count toward Innovo's future credit quota. The standard rate limits still apply, so the budget tracker, 422 halving and 429 `Retry-After` rules run unchanged (section 4), and the server's `X-RateLimit-*` headers stay the truth. |
| Where the key lives | **Only** in the developer's local, git-ignored `.env`, as `DATOMS_TOKEN`. It is not in Key Vault, CI or any Azure environment, so dev and prod keep `DATOMS_LIVE=false`. Never write the value in code, docs, fixtures, logs, prompts or commit messages. Do not open `.env` with an agent. |
| Who calls with it | Only the CLI scripts (`packages/datoms-client/scripts/`) and a worker running on a developer machine with `DATOMS_LIVE=true`, in id mode with a short list (ADR 0005). Fleet mode needs `--fleet` and is not needed for S2-02. |

### 3.2 What has been shared so far
- **APIs shared:** only the Asset List API (`GET /assets`, section 2.1) and the Asset Latest Data API (`GET /assets/{id}/data/latest`, section 2.2; CLI checks only, ADR 0010).
- **Parameter list:** keys, display names and default units for four asset categories, in `docs/source/datoms-parameters.md` (markdown copy of `datoms-parameters.xlsx`):

  | DATOMS category (as in the list) | Parameters |
  |---|---|
  | DG Set | 103 |
  | Fuel Tank | 4 |
  | AC Sub-Meter | 34 |
  | Solar Inverter | 23 |

  **The Asset List shows 8 DG Set assets, not 18** (checked 2026-10-12). The "(18)" in the sheet's tab name "DG Set (18)" is the DATOMS `category_id` of DG Set (18), not a count and not part of the category name (Q35). The category strings in the list match the Asset List exactly.

  **31 keys are used in more than one category with different display names** (the table at the end of the markdown copy). So `telemetry.parameter` stores names and units per (source system, source type, key), never per key alone (ADR 0011). The list is loaded by `db/seeds/datoms-parameters.sql`, exactly as given (a blank unit stays `NULL`). The list gives no data types (Q22).
- **What the real responses showed (2026-10-12, test key, `fixtures/`):**
  - `GET /assets`: 22 assets in one page (`pagination.total` 22, `total_pages` 1): 12 AC Sub-Meter, 8 DG Set, 1 Fuel Tank, 1 Solar Inverter. Fields per asset: `id` (legacy integer as a string), `name`, `created_at`, `lifecycle_status` (all `active`), `category_id`, `category_name` (the category string), `asset_info` (nameplate, with `null`s). No site, status or location field.
  - `GET /assets/{id}/data/latest` for one asset per category: the parameter keys equal the parameter list exactly (DG Set 103, Fuel Tank 4, AC Sub-Meter 34, Solar Inverter 23; none extra, none missing).
  - **Null values:** DATOMS sends keys it has no value for as `null` (96 of 103 DG keys, 1 of 4 Fuel Tank keys). **Decision (Ahmed, 2026-10-14): `null` means "no data".** `mapping.ts` drops null-valued keys from `SourceReading.values` (a real `0`, `false` or `""` is kept) and lists every key it saw, null or not, in `seenKeys`, so each key is still recorded in `telemetry.parameter` and the UI shows a never-reported key as "—". A null is never turned into 0.
  - **Bulk rows carry only `asset_id`, `success` and `data { time, parameters }`.** No site, status, location, asset type or alert field is in them, although DATOMS said the portal data is in the bulk response (Q9, Q21, Q22). Those fields stay absent in `mapping.ts` until the sample and field list arrive. `lat`, `long`, `mc_st` and `under_maintenance` are ordinary parameters and are not mapped to location or status.
  - One DG Set (asset 42485) last reported on 2026-10-05, 7 days before the check: `data.time` can be old. Change detection and "no data yet" rules apply as usual.
- **Not shared yet:** the site list, location and the other fields (status, the asset type field, alerts). DATOMS said on 12 Oct 2026 that they will arrive "in the coming week" (Q1, Q21, Q22).
- **No tower crane category** is in the list (and no hoist category). Whether tower cranes are connected to DATOMS, and which parameters they will send, is Q33. Until it is answered, crane figures on the equipment screens show "no data yet" (`02` R-24).

### 3.3 Is the bulk endpoint enabled for the test key? (checked in S2-02: yes)
**Answered 2026-10-12: yes (table below).** S2-02 checked it with **one** bulk call:
- Id mode, `{ "asset_ids": [...] }`, with a few ids taken from the Asset List. One request, with no loop and no retry (a 401 or 403 is never retried anyway).
- Record the result in the table below and in Q34: date, HTTP status, the error `code` if any, rows returned and credits charged (from the headers). Never record the token or the request headers.
- **If it is enabled:** save the response to `packages/datoms-client/fixtures/` (tokens and headers removed). Later live checks use id mode with a short list.
- **If it is not enabled:** record that, keep the worker on fixtures (`DATOMS_LIVE=false`), and ask DATOMS to enable it (Q34). **The worker never falls back to `data/latest`:** per-asset latest stays CLI-only (ADR 0010, `CLAUDE.md` rule 5).

| Date | Result | Notes |
|---|---|---|
| 2026-10-12 | **Enabled.** Id mode, 4 ids (one per category), one call: HTTP 200, no error code, 4 rows, all `success: true`, 4 credits charged. | Headers: `X-RateLimit-Unit: asset-read-credits`, `Limit: 2000` (= 4F with F = 500, the 1-minute credit cap), `Remaining: 1996`, `Reset: 61`. Each row's `parameters` equal that asset's `data/latest` exactly. Q34 answered. Fixture: `fixtures/bulk-latest-id-mode.json`. |

| 2026-10-14 | **Fleet mode works.** `{page:1, limit:500}`, 4 calls 60 s apart: each HTTP 200, 22 rows, 22 `success: true`, 0 `false`; `pagination` = `{total:22, page:1, limit:500, total_pages:1}`; 22 credits per call. | Headers: `Unit: asset-read-credits`, `Limit: 2000`, `Remaining` 1978 then 1956 inside the same minute (so 22 credits each), `Reset` 61 then 1 (seconds left in the window). Fixtures `bulk-fleet-page1-run1..4.json`, `bulk-fleet-summary.json`. See the cadence below. |

**Observed reporting cadence (2026-10-14, 4 fleet runs, 3 deltas per asset, answers part of Q12).** `data.time` advanced between runs for 19 of 22 assets. Delta between consecutive different `data.time` values: median 61 s, typically 45 to 90 s (51 deltas; one outlier of 2,342 s is an asset that resumed after about 39 minutes).
- AC Sub-Meters and the Solar Inverter: about 60 s (50 to 71 s).
- DG 42482 and 42483 and the Fuel Tank: alternating 45 s and 90 s (about 60 s on average).
- The four "Source -2 ... (Channel n)" DG Sets: about 80 s.
- **Stale (never advanced):** DG 42485 (last `data.time` 2026-10-05T04:28:45Z), DG 42484 (2026-09-19T02:00:55Z), AC Sub-Meter 33851 (2026-09-20T09:15:10Z). AC Sub-Meter 33902 was stale for about 39 minutes and updated in the last run. Stale assets still come back as `success: true` with their old `data.time`, so "reported" does not mean "fresh".
- **Nulls** (last run): AC Sub-Meter 0 of 408 values null (all 34 keys never null); DG Set 673 of 824 null (6 keys never null: `mt_pf`, `mvol`, `calculated_energy`, `lat`, `long`, `mcurr`; 70 always null); Solar Inverter 1 of 23 (`calculated_sol_enrg` always null); Fuel Tank 1 of 4 (`fuel_filled` always null). The four "Channel n" DG Sets have 71 to 72 nulls of 103, the other four DG Sets 96 to 97.

Rate-limit headers seen on 2026-10-12: `GET /assets` sends `Limit: 60`, `Remaining`, `Reset` (60 s) and **no `X-RateLimit-Unit`**; the per-asset latest call sends `Limit: 8`, `Remaining`, `Reset` (300 s) and **no Unit**; the bulk call sends the Unit. The client reads the Unit first and, when it is missing, ignores Limit/Remaining for the credit budget (`budget.ts`).

### 3.4 DATOMS categories and Nexus asset types
The mapping is data, not code: the seed appends each DATOMS category name to `core.asset_type.source_names`, and the worker matches `core.asset.source_type_name` against it (the section 6 rules for unknown type names still apply). Mapping given by Ahmed on 12 Oct 2026 (ADR 0011):

| DATOMS category | `core.asset_type.code` | `category` |
|---|---|---|
| DG Set | `diesel_generator` | energy |
| Fuel Tank | `fuel_tank` (new) | energy |
| AC Sub-Meter | `mains` | energy |
| Solar Inverter | `solar` | energy |

- The category strings are **confirmed** by `GET /assets` (field `category_name`, 2026-10-12, Q35): `DG Set`, `Fuel Tank`, `AC Sub-Meter`, `Solar Inverter`. The seed is unchanged.
- Which screens show fuel tanks (the energy table names DGs, solar and mains) is Q36.

### 3.5 Confirmed by DATOMS, waiting for field names
DATOMS has confirmed that **everything visible in its portal is in the bulk response** (Q9, answered). DATOMS has promised:
- **(Q21)** a real sample bulk response. When it arrives, save it to `packages/datoms-client/fixtures/` with tokens and headers removed.
- **(Q22)** an updated API document listing the bulk fields for sites, status, location, asset type and alerts.

The first real bulk rows (section 3.2) carry **none** of the sites, status, location, type or alert fields, so these stay absent in `mapping.ts` until the sample and list arrive. They **no longer block the start of S2-02**: the test key unblocked it on 12 Oct 2026. They are still needed to map sites, status, location, asset type and alerts (S2-02's mapping for those stays empty; S3-01, S4-05, S6-04). Until they arrive, the matching Nexus field stays empty and the UI shows "no data yet". When they arrive, only `src/mapping.ts`, its tests and the fixtures change.

| Needed for | In the bulk response (field names pending Q21/Q22) | Nexus target |
|---|---|---|
| Portfolio map | Site with coordinates, state, district | `core.project` |
| Asset placement | Asset → site link, asset location (lat/lng), asset type. The DG Set list has keys `lat` and `long`; whether they are the location Nexus should use is part of Q22 (not assumed). | `core.asset.project_id`, `asset_location_current`, `asset_type` |
| Status colours | Asset status (Running / Idle / Maintenance / Off) as shown in the portal. The DG Set list has `mc_st` (Machine Status) and `under_maintenance`; whether they carry the portal status is part of Q22 (not assumed). | `asset_status_current`, `status_map` |
| Alerts | Alerts / notifications with time, severity, asset | `events.event` |
| Energy box | Site totals (load, solar, mains ratio), if the portal shows them (Q3) | `latest_packet` of a `kind = 'site_metric'` asset (ADR 0009) |
| Parameter metadata | Display names and units: **received for four categories** as a list (section 3.2) and seeded per source type (ADR 0011). Still pending: data types, any other categories, and whether bulk rows also carry names and units (Q22). | `telemetry.parameter` |
| Trends after downtime | History per asset and time range | **Not in the bulk endpoint.** On hold: a history feed needs a new ADR (see ADR 0010, Consequences). |
| Real-time < 60 s | WebSocket / MQTT / webhooks (Q6) | New ingest path (ADR); screens unchanged |

## 4. Client behaviour (must be implemented and unit-tested)
1. **Paging walker.** Loop pages until `page >= total_pages`. Process and release each page before fetching the next.
2. **Budget tracker.** Keep sliding windows (1 m, 5 m, 1 h, 24 h, 30 d) of credits spent and requests made. Each cap is multiplied by setting `budget.max_share` (ADR 0005; prod 1.0, dev small). Before each call, estimate its cost (`min(limit, remaining assets)` in fleet mode, the number of ids in id mode) and **wait or skip** if it would go past 90% of any cap. After each call, use the server's headers as the truth. The quota is shared with every other consumer in the org, so never assume Nexus is the only one. Persist each call to `integration.api_call` so a restart doesn't forget usage.
3. **Adaptive interval.** Use each asset type's interval (`asset_type.poll_interval_seconds`, otherwise `poll.interval_seconds` = 60). If any window passes 80%, multiply every interval by 2, then by 5, and log a warning. Return to normal when the window clears.
4. **Retries.** 429 waits `Retry-After`. 5xx and network errors back off with jitter (1 s, 2 s, 4 s, 8 s, maximum 5 tries). 401/403/400 never retry; alert instead.
5. **Timeouts.** 30 s per request. The whole poll must finish within the interval; if not, skip the next tick (no overlap).
6. **Change detection.** Write a packet only if `data.time` is newer than `latest_packet.ts` for that asset. **Replace, never merge:** a newer packet **replaces** `latest_packet.values` with that packet's values (null keys already dropped by the mapping). Merging into the stored object would keep showing an old value for a parameter that has gone null.
7. **Mapping.** All of it is in `src/mapping.ts`. It turns raw DATOMS rows into `SourceReading { externalAssetId, ts, values }` plus, when present in the row, status, location, asset type, site link, kind (`physical` / `site_metric`) and alerts. Keys and values pass through unchanged, except that keys whose value is `null` are dropped from `values` (null means "no data"). `seenKeys` lists every key in the row, null or not; **unknown keys, taken from `seenKeys`, are recorded in `telemetry.parameter`** per (source system, the asset's source type, key) (ADR 0011). `latest_packet` is replaced per packet, never merged (item 6). A missing field maps to "absent", never to a default value.
8. **Logging.** For each call log the endpoint, mode, page, HTTP status, duration, credits, rate-limit headers and correlation id. Never log the token.
9. **Fixtures and the CLI.** `scripts/record.ts` saves real responses (body plus a `meta` block with the path, method, date, status and rate-limit headers; no request headers or tokens) into `fixtures/`. Run the CLI with `DATOMS_LIVE=true pnpm --filter @nexus/datoms-client live -- --env-file <path-to-.env> list | latest <id> | bulk <id>...` (it compiles first with `tsc`, no extra tool; `--fleet` for fleet mode). It is the **only** code that calls `data/latest`; a test (`test/boundaries.test.ts`) fails if anything else mentions it. Tests and local dev use fixtures. `DATOMS_LIVE=true` is needed to call DATOMS. Live CLI runs use id mode with a short list by default; fleet mode against live DATOMS needs an explicit `--fleet` flag (ADR 0005). With the provisional test key (section 3.1), recording is done from a developer machine only, and the data is live, so check fixtures for anything sensitive before committing.
10. **Learned page size.** After a 422, keep the smaller page size in `integration.cursor` (`job = 'live_poll'`, `value.pageLimit`) so the next poll starts with it. Try 500 again once a day.
11. **Poll scope.** If `poll.subset_external_ids` is a list, poll only those ids in id mode (non-prod, ADR 0005). If it is `null`, plan each tick from the per-type intervals: use fleet mode when every asset is due, otherwise id mode for the due ids (ADR 0006).

## 5. Worker jobs
| Job | Schedule | Steps |
|---|---|---|
| `catalogue-sync` | On start, then hourly, plus early when the poll sees unknown ids (at most once per 5 min) | listAssets (all pages; names and nameplate) → upsert assets → retire safely (section 6) → `sync_run`. Spends no bulk credits. The logic is pure code in `packages/connectors/core/src/catalogue/` (`runCatalogueSync`, behind a `CatalogueRepository`); the worker job only wires the connector, the Kysely repository, the settings and the schedule. |
| `live-poll` | Every 60 s by default (per-type and adaptive), leader only | budget check → bulk pages (fleet or id mode) → upsert sites, asset types and parameter keys found in the rows (new ones go to `link_todo` / `telemetry.parameter`, keyed per source type, ADR 0011) → change detection → write packets, latest values, status, location and alerts (`events.event`) → publish slim messages to Web PubSub per project (`10-api-design.md`) → `sync_run` (lag = now − newest ts) |
| `history-backfill` | **On hold** | Needs a DATOMS history feed and a new ADR (ADR 0010). Not built in phase 1 until decided. |
| `rollups` (ADR 0007) | 5 min: each closed bucket, at bucket end + `rollup.close_grace_intervals` (2) × the current poll interval. 1 h: right after the hour's last 5-min bucket. 1 d: after the Dubai day's last hour (about midnight + 10 min). | SQL only: `refresh_rollup_5m(bucket_start, bucket_end)` once per closed bucket, and again only for closed buckets that got late packets (the poll records the oldest `ts` it wrote). `refresh_rollup_combine` for 1 h and 1 d in batches of 1,000 assets. No sliding window, no per-minute refresh, no in-memory accumulators (that is a scale trigger in `12` §2). |
| `maintenance` | Daily 02:00 Asia/Dubai | Partitions ahead, retention drops, `api_call` cleanup. Archive to Blob deferred (ADR 0008). |

There is no separate `events-sync` job: alerts come in the bulk response (ADR 0010).

**Leader election:** `SELECT pg_try_advisory_lock(hashtext('nexus-worker-leader'))` on a dedicated connection. Only the holder runs DATOMS jobs. Check the lock connection before each job; if it was lost (for example after a database failover), stop and try to take the lock again. This keeps the worker safe if two replicas ever start.

## 6. Linking new sites and assets automatically
- **Until the bulk site fields are mapped (Q21, Q22):** projects are created by an admin (R-63, `/admin/projects`), and DATOMS assets are assigned to them from the linking to-do. The worker never invents a project.
- **Once site fields are mapped:** a new DATOMS site creates a `core.project` with `state` from the source (or `unknown`). It is visible to `all_projects` roles at once, and to others once an admin grants access.
- A new asset is linked to its project by the DATOMS site id. If the site is unknown it gets `project_id = null` and a `link_todo` row.
- A new asset type name is set to `generic` with a `link_todo`; once an admin maps it, the icon changes. Names already in `core.asset_type.source_names` (for example the four DATOMS categories seeded from the parameter list, section 3.4) map directly.
- A new status label gets display `unknown` with a `link_todo`.
- **Existing assets.** The sync updates only what the source states and that differs (name, nameplate in `asset_info`, source type, created time). A field the source leaves out never overwrites a stored value. An asset still on `generic` is re-typed once its type name is mapped in `source_names`; a type an admin set by hand is not overwritten. A retired asset that appears again gets `retired_at` cleared.
- **Retire safely.** An asset (or, later, a site) is retired only after a **complete** catalogue walk where the number seen equals `pagination.total`, and only if it was missing from `catalogue.retire_after_misses` (2) consecutive complete walks. If one sync would retire more than `catalogue.retire_max_fraction` (5%) of active assets, it retires nothing and raises an alert. Retired rows keep their history (`retired_at`, never delete). An incomplete walk neither counts a miss nor resets one; an asset that re-appears starts again from zero. The miss counter is not a `core.asset` column: it is kept in `integration.cursor` (`job = 'catalogue_sync'`). Both limits come from settings, not code.
- **Unknown ids in the poll.** Bulk rows for ids the catalogue doesn't know yet are skipped, counted in `sync_run`, and trigger an early catalogue sync.
- **Id stability.** If DATOMS ever changes an asset's id (legacy integer → UUID, Q11), the asset would look new and the old one would be retired. Until Q11 is answered, an admin can relink history through the linking to-do.
- **No code change is ever needed for growth.**

## 7. Contract tests (`tests/contract/`)
Run nightly against the live API (read-only), and by hand when DATOMS announces a change. While the only credential is the provisional test key (section 3.1, kept only in a local `.env`), they run by hand from a developer machine; the nightly CI run starts once a credential may be stored in CI (Q7). They use **id mode with a few ids** so they spend almost no credits (ADR 0005). They check:
- Response shapes (zod) for each endpoint.
- Pagination totals.
- That the rate-limit headers are present.
- That 422 handling works on a forced small limit.
- That fixtures still match the live shape. If not, the build fails with a diff.
