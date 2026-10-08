# 12 · Scalability

**Now:** fewer than 500 users, about 250 assets, 1 pilot site growing to all DATOMS sites.
**Design target without redesign:** 5,000 users, 500 sites, 20,000 assets.
**Rule:** build for now, but never make a choice that blocks the target. Scale by turning knobs, not by rewriting.

## 1. Why this design scales
| Pressure | Why it doesn't break |
|---|---|
| More users | Users read only Nexus's DB and Web PubSub. DATOMS calls stay the same for 1 user or 5,000. The API is stateless, so add replicas. |
| More sites / assets | One bulk call covers 500 assets. Pages grow linearly (20,000 assets = 40 calls per minute, under the 240/min limit). Catalogue sync is automatic. |
| More data | Daily partitions, rollups and retention by partition drop. Charts read rollups, never raw packets, for ranges over 6 h. |
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
| More than 3 API replicas, or auth/lookup cache misses | Add **Azure Cache for Redis** for AccessContext, `latest_packet` and summaries | small |
| More than ~800 concurrent live connections (1 Standard unit = 1,000) | Raise Web PubSub units (1 unit per 1,000 connections) | config |
| Poll takes more than 30 s (≈ 10k+ assets) | Process pages in parallel (2–4 at a time, within the 240/min limit); keep one leader | small |
| Hourly rollup close takes more than 5 min | Smaller batches spread over the hour, or compute 1 h in memory like 5 min | small |
| Raw packets > 1 TB, or long scans | Lower raw retention; archive to Blob Parquet; query the archive through a separate analytics path | medium |
| 20,000+ assets or second-level data | Move raw telemetry to Azure Data Explorer, or self-managed TimescaleDB / Tiger Cloud (ADR). Keep rollups and latest in Postgres. The API repository interface hides the change. | medium |
| DATOMS streaming / webhooks | Add an ingest endpoint or subscriber plus Azure Service Bus, with consumers writing the same tables (ADR) | medium |
| A team owns one module full-time | Split that module into its own service (its tables are already separate) | medium |

## 3. Load and scale tests (must exist before go-live)
- **API:** k6 with 1,000 virtual users (2× the current users, all online) doing the realistic mix (portfolio, project page, asset panel, trend). Targets in `02-requirements-phase1.md` N-04.
- **Worker:** the fixture replay generator at 100 sites / 5,000 assets, then 500 / 20,000. The poll plus writes must finish under 30 s; rollups under 20 s per minute.
- **Live:** 1,000 Web PubSub clients receiving updates.
- **Proof of independence:** while load-testing the API with 1,000 users, the worker's DATOMS calls per minute must not change.
- Run these again at every major release and after any schema change on telemetry tables.

## 4. Things that would break scalability (do not do them)
- Calling DATOMS from the API or the browser.
- Per-user DATOMS calls, or per-asset `data/latest` in the poll loop.
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
