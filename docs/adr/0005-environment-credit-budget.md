# 0005 · DATOMS credit budget per environment: only prod polls the full fleet

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** Ahmed (architecture review 1, concern 2)

## Context
- The DATOMS bulk credit quota is **organisation-wide** (DATOMS v4 PDF, p. 11). Every credential in Innovo's org spends from the same caps: 4F per minute, 8F per 5 min, 100F per hour, 2,500F per 24 h and 60,000F per 30 days. F is the fleet size rounded up to 500, with a minimum of 500.
- One environment polling the full fleet every 60 s uses 43,200 credits per asset per month. When N = F, that is **72% of the 30-day cap**.
- A second environment doing the same would use 144% of the 30-day cap, 115% of the 24 h cap, 120% of the 1 h cap and 125% of the 5 min cap. Prod would be throttled with it, so prod freshness would suffer.
- The CLI (`poll --minutes N`), nightly contract tests and any developer with `DATOMS_LIVE=true` spend from the same quota.
- Today the fleet is a small demo set of under 500 assets, so F = 500 (`12-scalability.md`). At pilot size, two full-fleet environments would already use about 72% of the 30-day cap, close to the 80% slow-down threshold.
- Q7 (a DATOMS test org) and Q10 (separate quota for non-prod) are still open.

## Decision
**Only prod polls the full fleet.** Every other environment either uses fixtures or polls a small configured subset in **id mode**, which charges only the listed in-fleet ids. Each environment is capped to a share of every DATOMS window.

Details:
- Setting `poll.subset_external_ids` (jsonb array, default `null`). `null` means the full fleet. A list means id mode for those DATOMS ids only. It is set per environment through `db/seeds/`, never in code. Prod keeps `null`.
- Setting `budget.max_share` (default `1.0`). The budget tracker treats each DATOMS cap as `cap × max_share`, so the 80% slow-down and 90% wait rules (`07` §4) apply to that share. The dev seed sets a small share (e.g. `0.1`).
- Local and dev default to fixtures (`DATOMS_LIVE=false`). Live calls from dev or the CLI use id mode with a small list. The CLI refuses fleet mode against live DATOMS unless it is given an explicit `--fleet` flag.
- Because the quota is shared, the server's `X-RateLimit-*` headers stay the source of truth for what remains. The tracker never assumes it is the only consumer.
- If DATOMS provides a separate org or quota for non-prod (Q7, Q10), dev may poll its own fleet in full. Only the seed changes.

## Options considered
| Option | Pros | Cons |
|---|---|---|
| Only prod polls the full fleet; others use fixtures or an id-mode subset with a budget share (chosen) | Prod keeps its full budget; no change to the poll design; settings only | Non-prod never sees the whole fleet live |
| Every environment polls the full fleet | Realistic test data | Breaks the org-wide caps as soon as N approaches F |
| Non-prod replays prod's stored data | No DATOMS cost | Needs a copy pipeline between environments; more operations work |

## Consequences
- Prod freshness is protected from non-prod use.
- Dev tests full-fleet behaviour with fixture replay (`packages/testing` generators), not live DATOMS.
- The integration health page (R-61) shows the share in use and the remaining credits per window as DATOMS reports them.
- To reverse: set `poll.subset_external_ids = null` and `budget.max_share = 1.0` in an environment, once it has its own quota.
