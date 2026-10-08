# 0006 · Poll interval per asset type

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** Ahmed (architecture review 1, concern 3)

## Context
- A full-fleet poll every 60 s costs 43,200 credits per asset per month: 10.8 M at 250 assets, 21.6 M at 500 and 864 M at the 20,000-asset target (`07` §2.3).
- The Innovo contract has a monthly credit allowance that is not known yet (Q5). The growth policy is also open (Q14).
- Until now the only answer to budget pressure was the adaptive interval, which slows **every** asset to 120 s, then 300 s.
- Fleet mode charges for every in-fleet row returned. Id mode charges only for the listed in-fleet ids (DATOMS v4 PDF, p. 11). This makes it possible to poll some assets less often without paying for the rest.
- Today the fleet is under 500 assets (F = 500), so credits are not a constraint for the pilot (`12-scalability.md`).

## Decision
Each asset type can have its own poll interval, stored as data in `core.asset_type.poll_interval_seconds`. A value of `null` means use the global `poll.interval_seconds` (60). Values below 60 are not allowed. Admins set the column; nothing is hard-coded.

How the worker plans each tick:
1. An asset is **due** when its type's interval has passed since its last successful poll.
2. If every in-scope asset is due, use **fleet mode** (one page walk, pages of 500).
3. Otherwise, poll only the due assets in **id mode**, in chunks of up to 500 ids. The ids come from the catalogue (`core.asset.external_id`).
4. The budget tracker and the adaptive slow-down (`07` §4) still apply on top of this. Under budget pressure, every interval is multiplied by the same factor.
5. A new asset that the catalogue has not seen yet is picked up by the next fleet walk or the next catalogue sync.

Phase 1 ships with every type set to `null` (60 s). The column exists so that Innovo can use a longer interval for some types if the allowance requires it, with no code change (Q14).

## Options considered
| Option | Pros | Cons |
|---|---|---|
| Interval per asset type, fleet mode when all are due, otherwise id mode (chosen) | Spends credits only where freshness matters; data-driven | Worker scheduler is a little more complex; freshness differs by type |
| One global interval, slowed down under budget pressure | Simplest | Every asset gets staler together, even the important ones |
| Buy a tier that covers 60 s for every asset | No code | Cost grows linearly to 864 M credits per month at 20,000 assets; not in Nexus's control |

## Consequences
- Every live value already carries `ts` and `stale`, so users see per-asset freshness. A type polled every 300 s shows its real age.
- `stale` (R-27) must use at least twice the asset's own poll interval. Otherwise slow-polled types would always look stale. The DATOMS offline rule (Q8) still wins when it is known.
- 5-minute rollups for a slow-polled type have fewer packets per bucket. Charts show this through the coverage figure (ADR 0007).
- To reverse: set every `poll_interval_seconds` back to `null`.
