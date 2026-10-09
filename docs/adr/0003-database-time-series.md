# 0003 · PostgreSQL 16 with native partitioning and Nexus rollups (no TimescaleDB dependency)

- **Status:** accepted (changes the earlier plan, which said "PostgreSQL + TimescaleDB"). **Amended by `0007-sql-rollups-per-closed-bucket.md` on 2026-10-08:** rollups are built by the SQL functions once per **closed** 5-minute bucket, run 2 poll intervals after the bucket ends. There is no per-minute or sliding refresh, and phase 1 has no in-memory accumulators. 5-minute rollup retention is 60 days.
- **Date:** 2026-10-07
- **Deciders:** Ahmed

## Context
- Azure Database for PostgreSQL Flexible Server supports only the **Apache-licensed** edition of TimescaleDB. **Compression and continuous aggregates** are in the Timescale-licensed (TSL) edition and are **not available** on Azure. Microsoft has said it has no plans to support TSL.
- Innovo wants Azure (UAE North) or on-premise.
- DATOMS sends about 1 packet per asset per minute, with about 103 parameters.

## Decision
- Use plain **PostgreSQL 16** (Azure Flexible Server; the same SQL runs on-premise) with:
  - one row per asset packet in `telemetry.packet` as `jsonb` (lz4), **partitioned by day**;
  - Nexus rollup tables `rollup_5m` (monthly partitions), `rollup_1h` and `rollup_1d` (local Dubai days), built by idempotent SQL functions. ~~that the worker calls every minute~~ **Amended (ADR 0007):** the worker calls them once per closed bucket (5 min: 2 poll intervals after the bucket ends; 1 h: after the hour's last bucket; 1 d: after the Dubai day's last hour);
  - retention by dropping partitions, using settings in `core.setting`.
- The only extension is `pg_trgm` (standard contrib, allowed on Azure) for fast name search.
- Benchmark on 7 Oct 2026 (`06-database.md` section 6): every screen query took 0.5–400 ms. A sliding SQL rollup was too slow at scale. ~~so 5-minute rollups are built in the worker's memory.~~ **Amended (ADR 0007):** one closed bucket takes 0.68 s for 300 assets, so phase 1 uses SQL per closed bucket. In-memory rollups are a scale trigger in `12-scalability.md` §2.

## Options considered
| Option | Pros | Cons |
|---|---|---|
| Native partitioning + own rollups (chosen) | Runs on Azure and on-prem; no licence trap; full control | We maintain rollup and partition functions (small, tested in `db/schema.sql`) |
| TimescaleDB Apache on Azure | Hypertables, time_bucket | No compression or continuous aggregates, the two features we need |
| Self-managed TimescaleDB (VM/AKS) | All Timescale features | We run the database ourselves (backups, HA, patching) |
| Tiger Cloud (managed Timescale) | All features, managed | Region and data residency in the UAE must be checked; another vendor |
| Azure Data Explorer | Huge scale analytics | Extra service and cost; overkill now |

## Consequences
- Charts over ranges longer than 6 h always read the rollups.
- If raw volume grows past about 1 TB, move raw packets to ADX or a managed Timescale. Rollups and latest values stay in Postgres. The repository interface hides the change (`12-scalability.md`). **Amended (2026-10-08):** with the benchmark's row sizes, raw packets reach 1 TB at about 5,600 assets (90-day retention), not 20,000. See the sizing in `06` §6a, which is to be re-measured with real fixtures in S2/S3.
