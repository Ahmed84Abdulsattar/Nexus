# 0003 · PostgreSQL 16 with native partitioning and Nexus rollups (no TimescaleDB dependency)

- **Status:** accepted (changes the earlier plan, which said "PostgreSQL + TimescaleDB")
- **Date:** 2026-10-07
- **Deciders:** Ahmed

## Context
- Azure Database for PostgreSQL Flexible Server supports only the **Apache-licensed** edition of TimescaleDB. **Compression and continuous aggregates** are in the Timescale-licensed (TSL) edition and are **not available** on Azure. Microsoft has said it has no plans to support TSL.
- Innovo wants Azure (UAE North) or on-premise.
- DATOMS sends about 1 packet per asset per minute, with about 103 parameters.

## Decision
- Use plain **PostgreSQL 16** (Azure Flexible Server; the same SQL runs on-premise) with:
  - one row per asset packet in `telemetry.packet` as `jsonb` (lz4), **partitioned by day**;
  - Nexus rollup tables `rollup_5m` (monthly partitions), `rollup_1h` and `rollup_1d` (local Dubai days), built by idempotent SQL functions that the worker calls every minute;
  - retention by dropping partitions, using settings in `core.setting`.
- The only extension is `pg_trgm` (standard contrib, allowed on Azure) for fast name search.
- Benchmark on 7 Oct 2026 (`06-database.md` section 6): every screen query took 0.5–400 ms. A sliding SQL rollup was too slow at scale, so 5-minute rollups are built in the worker's memory.

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
- If raw volume grows past about 1 TB or the fleet passes about 20,000 assets, move raw packets to ADX or a managed Timescale. Rollups and latest values stay in Postgres. The repository interface hides the change (`12-scalability.md`).
