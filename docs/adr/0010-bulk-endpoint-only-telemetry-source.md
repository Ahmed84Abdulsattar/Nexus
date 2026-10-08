# 0010 · The DATOMS bulk endpoint is the only telemetry source

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** Ahmed, Innovo Labs; confirmed with DATOMS

## Context
- The v4 PDF (16 Sep 2026) documents three endpoints: list assets, latest data for one asset, and bulk latest. It says bulk rows carry "exactly the current DG projection (103 parameters)".
- **DATOMS has confirmed** that everything shown in its portal is available to Nexus in the **bulk endpoint response**. That includes sites, generators, tower cranes, statuses, locations, alerts and all parameters. This answers Q9.
- Today's fleet is a small demo set (generators and tower cranes). More asset types will be added later and must appear automatically.
- DATOMS has promised a real sample bulk response (Q21) and an updated document listing the bulk fields for sites, status, location, asset type and alerts (Q22). Exact field names are not known yet.
- Per-asset `GET /assets/{id}/data/latest` is limited to about 1 call per minute per asset (8 per 5 min, 1,500 per 24 h) and is banned in the poll loop (`CLAUDE.md` rule 5).

## Decision
Nexus reads telemetry **only** from `POST /assets/telemetry/latest/query`, and shows exactly what it returns, for **every** asset type.
- No per-type endpoints and no separate crane handling. Status, location, asset type, site link and alerts are taken from the bulk rows once their field names are known.
- `GET /assets/{id}/data/latest` is used **only** by the CLI checks in `packages/datoms-client/scripts/`, never by the worker, API or browser.
- Anything missing from a bulk row is shown as **"no data yet"** ("—" with a timestamp). It is never guessed.
- The hourly catalogue sync (`GET /assets`) stays. It supplies the asset list and nameplate (`asset_info`), and it is not telemetry.
- **Field mapping lives in one file:** `packages/datoms-client/src/mapping.ts`. Until the sample arrives, build against the v4 PDF shape. When the sample arrives, save it to `packages/datoms-client/fixtures/` with tokens and headers removed. Then only `mapping.ts`, its tests and the fixtures change.
- Alerts arrive in the same bulk response, so there is no separate events-sync job. The live-poll pipeline upserts them into `events.event`.

## Options considered
| Option | Pros | Cons |
|---|---|---|
| Bulk endpoint only (chosen) | One call pattern, one credit model, one mapping file; new asset types appear with no code | Alerts and statuses that start and end between two polls may not be seen (the PDF says bulk "does not return events produced between polls") |
| Bulk plus per-type or per-asset endpoints | Can fill gaps | Per-asset limits; credit and request growth with fleet size; DATOMS knowledge spread across code |
| Bulk plus a separate events or history feed | Complete alert and history record | Not offered in v4; extra credits; not chosen now (see Consequences) |

## Consequences
- `02` (data note, sources), `07` §2.3 and §3, `03` §4.2 and §5, `05` and `06` §4 say "bulk only".
- Q9 is answered, and Q1 is narrowed to field names only (Q21, Q22).
- S2-02 (DATOMS client) needs the sample and the field list before it starts. They do **not** block S0 or S1.
- **Not decided by this ADR:** whether Nexus may later use a DATOMS **history** feed for gap repair (S3-04) or a dedicated **events** feed. Both would need a new ADR. Until then, `history-backfill` is on hold, and alerts are as present in the bulk response at poll time.
- To reverse: a new ADR naming the extra endpoint and its credit cost, implemented inside `packages/datoms-client` only.
