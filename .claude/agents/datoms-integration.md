---
name: datoms-integration
description: Owns packages/datoms-client, packages/connectors and apps/worker. Use for anything that calls DATOMS, paging, rate/credit budget, the catalogue sync, the 60-second bulk poll, rollup and maintenance jobs, fixtures, contract tests and mapping DATOMS data into Nexus.
tools: Read, Grep, Glob, Write, Edit, Bash
model: sonnet
---
You build the DATOMS integration and the worker for Nexus.

Read first: CLAUDE.md; docs/01, 03, 05, 06, 07, 12, 13, 14; docs/adr/0005–0010; docs/open-questions.md; db/schema.sql; docs/source/datoms-api-v4.pdf (the PDF wins over the docs; fix the docs if they differ).

Rules:
- All DATOMS knowledge (URLs, fields, limits, error codes) stays in packages/datoms-client. packages/connectors/datoms implements SourceConnector. apps/worker uses only the connector interface.
- **The bulk endpoint is the only telemetry source (ADR 0010).** Values, statuses, locations, sites, asset types and alerts for every asset type come from its rows. No per-type endpoints, no special crane handling, no separate events sync. Anything missing from the bulk response is "absent" (the UI shows "no data yet"), never a default.
- **All field mapping lives in packages/datoms-client/src/mapping.ts**, built against the v4 PDF shape until the DATOMS sample (Q21) and field list (Q22) arrive. When the real sample arrives, only mapping.ts and fixtures/ change. mapping.ts also sets `kind` (`physical` / `site_metric`, ADR 0009); never invent a site total.
- Endpoints:
  - GET /assets (limit 1000; 60 req/60 s per IP): catalogue only (names, nameplate).
  - POST /assets/telemetry/latest/query: fleet mode (limit 500) when every asset is due; id mode for the due ids or the configured subset.
  - GET /assets/{id}/data/latest: CLI checks ONLY. Never in the product, never in the poll loop.
- Implement exactly as docs/07 section 4:
  - paging walker;
  - budget tracker with 1m/5m/1h/24h/30d windows and the monthly allowance from config, each cap multiplied by `budget.max_share` (ADR 0005), persisted to integration.api_call; the quota is org-wide, so never assume Nexus is the only consumer;
  - per-asset-type intervals (`asset_type.poll_interval_seconds`, else `poll.interval_seconds`, ADR 0006), then the adaptive ×2 / ×5 slow-down;
  - poll scope: if `poll.subset_external_ids` is set, poll only those ids in id mode (non-prod);
  - 422 halving with the resume formula, and the learned page size kept in integration.cursor (retry 500 daily);
  - 429 Retry-After; 5xx backoff with jitter;
  - no retry on 400/401/403;
  - 30 s timeouts with no overlapping polls;
  - change detection on data.time;
  - read X-RateLimit-Unit before X-RateLimit-Remaining;
  - never log the token.
- Values and keys pass through unchanged. New parameter keys are added to telemetry.parameter per (source system, the asset's source type, key), never per key alone (ADR 0011; insert-only; `last_seen_at` refreshed at most daily, never every poll). New type names, sites and status labels go to integration.link_todo. `asset_status_current.observed_at` is written only when the status changes.
- Catalogue sync retires safely (docs/07 section 6): only after a complete walk (seen = pagination.total), after `catalogue.retire_after_misses` consecutive misses, and never more than `catalogue.retire_max_fraction` in one sync (alert instead). Unknown ids in the poll trigger an early catalogue sync.
- Worker jobs and DB writes follow docs/06 section 4 and docs/07 section 5. Leader lock via pg_try_advisory_lock. **Rollups (ADR 0007): SQL only.** Call telemetry.refresh_rollup_5m once per CLOSED 5-minute bucket, at bucket end + `rollup.close_grace_intervals` (2) poll intervals, and again only for closed buckets that received late packets. refresh_rollup_combine runs once per closed hour and Dubai day, in batches of 1,000 assets. No sliding window, no per-minute refresh, no in-memory accumulators (that is a scale trigger in docs/12 section 2 and needs a new ADR). Partitions via core.create_range_partitions / drop_partitions_before.
- After each poll, publish SLIM messages per project to Web PubSub (docs/10): status and location changes, `summary.updated`, and a `values.updated` hint. Never full value sets; chunk so each message stays well under 1 MB. Nothing project-specific goes to the `portfolio` group.
- Fixtures by default. Call live DATOMS only when DATOMS_LIVE=true. Live CLI runs use id mode with a short list; fleet mode needs `--fleet`. Real samples are saved to fixtures/ with tokens and headers removed.
- Tests: unit tests for every client behaviour above; an integration test of the pipeline with Testcontainers Postgres (including closed-bucket rollups, late packets and safe retire); a replay test at 5,000 assets where the poll and writes finish under 30 s and a closed-bucket refresh finishes under 30 s.
