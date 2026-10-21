# 12 · Scalability

**Now:** fewer than 500 users, and a small DATOMS demo fleet of under 500 assets (generators and tower cranes), with 1 pilot site growing to all DATOMS sites.
**Design target without redesign:** 5,000 users, 500 sites, 20,000 assets. Storage and DATOMS credits grow through the **planned** steps in section 2 (N-02).
**Rule:** build for now, but never make a choice that blocks the target. Scale by turning knobs, not by rewriting.

> **Credits are not a constraint for the pilot.** DATOMS sizes its caps by F, the fleet rounded up to 500 with a **minimum of 500**. With under 500 assets, F = 500, and one full-fleet 60 s poll uses at most 72% of the 30-day cap (less while the fleet is below 500). Credits become a planning item when the fleet grows (monthly allowance Q5, growth policy Q14) or if a second environment polls the full fleet (ADR 0005 prevents this).

## 1. Why this design scales
| Pressure | Why it doesn't break |
|---|---|
| More users | Users read only Nexus's DB and Web PubSub. DATOMS calls stay the same for 1 user or 5,000. The API is stateless, so add replicas. |
| More sites / assets | One bulk call covers 500 assets (ADR 0010: the bulk endpoint is the only telemetry source). Pages grow linearly (20,000 assets = 40 calls per minute, under the 240/min limit). **Credits grow linearly too:** 43,200 per asset per month at 60 s, which is 864 M at 20,000 assets. The levers are the monthly allowance (Q5, Q14) and per-type poll intervals (ADR 0006). Catalogue sync is automatic. |
| More data | Daily partitions, rollups and retention by partition drop (5-minute rollups kept 60 days). Charts read rollups, never raw packets, for ranges over 6 h. Raw packets need the planned storage step from about 5,600 assets (section 2). |
| More sensor types | Generic parameter model (jsonb), auto-discovered dictionary, generic UI rendering |
| More data sources | Connector interface; `source_system` + `external_id` on every row |
| More features | Modules with their own tables and permissions; feature flags; reserved routes |
| More developers | Monorepo with clear ownership (CODEOWNERS), shared types, OpenAPI contract, ADRs, agents that read the same docs |

## 2. Capacity plan: what to turn up, and when
| Trigger (measured) | Action | Effort |
|---|---|---|
| API p95 > 300 ms or CPU > 70% | Raise Container Apps max replicas (already autoscaling) | config |
| DB CPU > 60% sustained | Scale up the Postgres SKU (General Purpose → Memory Optimised) | config |
| Mostly read load on the DB | Add a **read replica**; route history and explorer queries to it | small (a second Kysely pool) |
| Front Door or App Gateway added in front of the API | Change `TRUST_PROXY` from `1` to `2`, **only with the conditions in docs/08 section 6**: the ingress must accept traffic from the front proxy alone (Front Door: `AzureFrontDoor.Backend` service tag restriction plus an `X-Azure-FDID` check; App Gateway: internal-only Container Apps environment). It is a network-exposure change and needs its own security review (Q20, ADR 0008). Otherwise the audit IP and the per-address limit see the front proxy's address | config + review |
| More than 3 API replicas, or auth/lookup cache misses | Add **Azure Cache for Redis** for AccessContext, `latest_packet` and summaries | small |
| More than ~800 concurrent live connections (1 Standard unit = 1,000) | Raise Web PubSub units (1 unit per 1,000 connections) | config |
| Web PubSub outbound message units above the included daily quota | Check the messages are still slim (`10-api-design.md`); join project groups only while a project page is open | small |
| Poll takes more than 30 s (≈ 10k+ assets; DATOMS page latency still to be measured, Q13) | Process pages in parallel (2–4 at a time, within the 240/min limit); keep one leader. Record the measured page latency here after the S2 CLI run. | small |
| 422 halving keeps pages below 500 rows (learned page size in `integration.cursor`) | Check the request count stays under 240/min (125-row pages need 160 requests at 20,000 assets); ask DATOMS for the size bound (Q13) | small |
| Monthly credit use > 80% of the allowance, or fleet growth above what the allowance covers at 60 s | Set a longer `asset_type.poll_interval_seconds` for the types Innovo chooses (ADR 0006, Q14), or buy a higher tier | config |
| 5-minute closed-bucket refresh takes more than 30 s (≈ 10,000+ assets; ~45 s estimated at 20,000), or rollups use more than 30% of DB CPU | Build 5-minute stats **in the worker's memory** from the packets it writes, keeping the SQL function as the recovery path (new ADR; reverses part of ADR 0007) | medium |
| Hourly rollup close takes more than 5 min | Smaller batches spread over the hour, or compute 1 h in memory as well (same ADR) | small |
| Raw packets > 1 TB (≈ 5,600 assets at 90 days with the benchmark's row size), or long scans | Lower raw retention (Innovo decides, Q15); turn on the archive to Blob Parquet (deferred, ADR 0008); query the archive through a separate analytics path | medium |
| Rollup storage keeps growing after the S2/S3 re-benchmark with real fixtures | Decide on a more compact rollup `stats` format (ADR) | medium |
| 20,000 assets, or second-level data | Move raw telemetry to Azure Data Explorer, or self-managed TimescaleDB / Tiger Cloud (ADR). Keep rollups and latest in Postgres. The API repository interface hides the change. | medium |
| ArcGIS usage (basemap sessions / tiles, elevation, 3D scene layers) > 80% of the plan from Q4 | Check the map only loads on map routes and views aren't re-created; move to a higher ArcGIS plan. Estimate before rollout: about 1,000 daily users × 3 map loads ≈ 3,000 map loads a day (~90,000 a month) at 5,000 users. Measure view loads in App Insights. | config / licence |
| Innovo needs edge security or a custom domain (Q20) | Add Azure Front Door + WAF (deferred, ADR 0008) | small |
| DATOMS streaming / webhooks | Add an ingest endpoint or subscriber plus Azure Service Bus, with consumers writing the same tables (ADR) | medium |
| A team owns one module full-time | Split that module into its own service (its tables are already separate) | medium |

## 3. Load and scale tests (must exist before go-live)
- **API:** k6 with 1,000 virtual users (2× the current users, all online) doing the realistic mix (portfolio, project page, asset panel, trend). Targets in `02-requirements-phase1.md` N-04.
- **Worker:** the fixture replay generator at 100 sites / 5,000 assets, then 500 / 20,000. Targets per job:
  - poll plus writes: under 30 s per poll;
  - 5-minute closed-bucket refresh: under 30 s per bucket;
  - hourly close: under 5 min;
  - daily close: under 15 min.

  Missing a target hits the matching trigger in section 2.
- **Live:** 1,000 Web PubSub clients receiving updates.
- **Proof of independence:** while load-testing the API with 1,000 users, the worker's DATOMS calls per minute must not change.
- Run these again at every major release and after any schema change on telemetry tables.
- **How to run:** scripts, thresholds and the fleet generator are in `tests/load/README.md` (S5-04).

### Load test results
Add one row per run (k6 summary kept with the PR or release notes).

| Date | Commit | Environment | Script and settings | Peak VUs | p95 latest / page / chart | Errors | Result |
|---|---|---|---|---|---|---|---|
| 2026-10-14 | S5-04 branch | local API | `api-1000-users.js`, `/health/live` only, smoke | 50 | 21 ms / n/a / n/a | 0% | pass (harness check only) |

## 4. Things that would break scalability (do not do them)
- Calling DATOMS from the API or the browser.
- Per-user DATOMS calls, or per-asset `data/latest` anywhere except the CLI (ADR 0010).
- A second environment polling the full fleet (ADR 0005).
- Putting parameter values in live push messages (ADR 0008).
- Charts over long ranges that read `telemetry.packet`.
- `SELECT *` on partitioned tables without a time filter.
- Storing one row per parameter per minute.
- Sticky sessions or in-memory state that must be shared across API replicas (beyond caches).
- Hard-coding sites, asset types or parameters.
- Running more than one poller without the leader lock.

## 5. Cost-aware defaults (for <500 users)
| Component | Start | Grow to |
|---|---|---|
| Container Apps API | 1–3 replicas, 0.5 vCPU / 1 GiB | 10 replicas |
| Worker | 1 replica, 1 vCPU / 2 GiB | 2 vCPU / 4 GiB |
| Postgres | General Purpose 2–4 vCores, 256 GB storage autogrow, HA in prod | Memory Optimised 8+ vCores + replica |
| Web PubSub | Standard, 1 unit (1,000 connections) | N units |
| Static Web Apps | Standard | — |
