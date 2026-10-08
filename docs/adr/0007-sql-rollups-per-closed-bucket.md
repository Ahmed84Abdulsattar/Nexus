# 0007 · Phase 1 rollups: SQL only, once per closed 5-minute bucket (amends 0003)

- **Status:** accepted (amends `0003-database-time-series.md`)
- **Date:** 2026-10-08
- **Deciders:** Ahmed (architecture review 1, concern 8)

## Context
- ADR 0003 said the worker calls the rollup SQL functions every minute over a recent window. `06` §4 then moved 5-minute rollups into the worker's memory, because a sliding SQL refresh every minute was measured as too slow at scale. That left two code paths: in-memory accumulators, plus SQL for recovery.
- The two paths add state and failure cases to the worker: restart, leader change, late packets. The team has two developers and the fleet is under 500 assets today.
- Measured on 7 Oct 2026 (`06` §6): `refresh_rollup_5m` for **one closed bucket** of 300 assets takes 0.68 s. That extrapolates to about 11 s per 5 minutes at 5,000 assets and about 45 s at 20,000.
- The bulk endpoint returns only the newest packet per asset. A packet whose device time falls in a bucket can arrive one poll after the bucket ends, so closing a bucket on the wall clock would miss data almost every time.
- Polling every 60 s samples the device data. It is not the full device history, so charts and timelines must say so.

## Decision
In phase 1, rollups are built **only by the SQL functions**, once per **closed** bucket. There is no sliding window and there are no in-memory accumulators.

- **5 minutes:** for each bucket, run `refresh_rollup_5m(bucket_start, bucket_end)` once, when the bucket ends plus `rollup.close_grace_intervals` × the current poll interval. The default is 2 intervals, which is 120 s at the normal 60 s.
- **Late packets:** the poll job records the oldest `ts` it wrote in each run. If that is inside a bucket that is already closed, `refresh_rollup_5m` is run again for that bucket only.
- **1 hour:** `refresh_rollup_combine` runs for the hour right after the hour's last 5-minute bucket is refreshed, in batches of 1,000 assets.
- **1 day (Asia/Dubai):** the combine runs once the Dubai day's last hour is combined, at about Dubai midnight + 10 min.
- **Coverage:** every rollup row already stores `packets`. The API returns `packets` and `expectedPackets` per bucket. `expectedPackets` is the bucket width × setting `telemetry.expected_packets_per_minute`; the default of 1 comes from the PDF's "typically once per minute" and is interim until Q12. Charts show coverage, so a thin bucket is visible and never hidden.
- **Timeline:** the status timeline is built from status changes that Nexus observed in polls. It is labelled **"observed by Nexus"** until DATOMS status history is available.
- **Scale trigger:** in-memory accumulators come back only through `12-scalability.md` §2. The trigger is a closed-bucket refresh that takes more than 30 s (about 10,000+ assets) or rollups that take more than 30% of DB CPU. That change needs a new ADR.

## Options considered
| Option | Pros | Cons |
|---|---|---|
| SQL only, once per closed bucket with a grace period (chosen) | One code path; stateless worker; restart-safe; late data handled the same way | About 45 s of DB time per 5 minutes at 20,000 assets |
| In-memory 5-minute rollups plus SQL recovery (previous `06` §4) | Near-zero DB cost at scale | Two code paths, worker state, harder failover, premature for under 500 assets |
| Sliding SQL refresh every minute (ADR 0003 as written) | Simple | Measured too slow (about 25–30 s per minute at 5,000 assets) |

## Consequences
- 5-minute buckets appear about 2 poll intervals after they end. Charts of the open period read the finer table (`06` §5).
- The re-benchmark with real fixtures in S2/S3 must include the closed-bucket refresh time. The compact rollup format question is decided then (ADR to follow if it changes).
- `06` §4, `07` §5, `db/schema.sql` comments, `04` and `05` describe this path. ADR 0003 has an "amended" note.
- To reverse: hit the `12` §2 trigger, write an ADR, and add accumulators. The SQL functions stay as the recovery path.
