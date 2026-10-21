-- retention_sync_run (S3-08).
--   * core.setting retention.sync_run_days: how long integration.sync_run rows are kept. The maintenance
--     job prunes older rows but always keeps the newest `catalogue.retire_after_misses` complete catalogue
--     runs, whatever their age: the safe-retire rule counts misses from them (docs/07 section 6).
-- Data only: no table changes. ON CONFLICT keeps an admin's value if the key already exists.

-- Up Migration
INSERT INTO core.setting (key, value, description) VALUES
  ('retention.sync_run_days', '90', 'Job run history (integration.sync_run) kept (days). The newest catalogue.retire_after_misses complete catalogue runs are always kept, whatever their age.')
ON CONFLICT (key) DO NOTHING;

-- Down Migration
DELETE FROM core.setting WHERE key = 'retention.sync_run_days';
