-- catalogue_sync_details (S3-01, phase 2).
--   * integration.sync_run.details: the typed summary of one job run (shape per job in
--     packages/shared, SyncRunDetails). The catalogue sync writes inserted / updated / retired / seen /
--     total / complete and warnings[] here; its safe-retire rule reads `complete` from the last runs.
--   * core.asset.source_lifecycle_status: the source's lifecycle label exactly as reported (DATOMS:
--     lifecycle_status). DISPLAY ONLY. Never used for status colours, counts, poll scope or retirement.
-- Both columns are nullable and have no default, so the change is instant. The new columns are the last
-- ones of their tables, in db/schema.sql too (pg_dump lists columns in creation order).

-- Up Migration
ALTER TABLE integration.sync_run ADD COLUMN details jsonb;
ALTER TABLE core.asset           ADD COLUMN source_lifecycle_status text;

-- Down Migration
ALTER TABLE core.asset           DROP COLUMN IF EXISTS source_lifecycle_status;
ALTER TABLE integration.sync_run DROP COLUMN IF EXISTS details;
