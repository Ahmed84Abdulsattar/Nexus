-- =====================================================================
-- DATOMS scope for APP_ENV=local and APP_ENV=dev ONLY (ADR 0005)
-- ---------------------------------------------------------------------
-- The DATOMS quota is shared with every other consumer of the organisation, so a non-production
-- Nexus must use a small part of it and poll only a few assets:
--   * budget.max_share          1.0  ->  0.1
--   * poll.subset_external_ids  null ->  the four fixture assets, one per DATOMS category:
--       43644 Fuel Tank, 43514 Solar Inverter, 43512 DG Set, 42426 AC Sub-Meter
-- Each value is changed only while it still holds its production default, so an admin's later change
-- is never overwritten by a repeated seed. Production never runs this file: the runner sets
-- nexus.app_env first, and the file refuses any other environment.
-- Safe to run again.
-- =====================================================================
DO $$
BEGIN
  IF current_setting('nexus.app_env', true) IS NULL
     OR current_setting('nexus.app_env', true) NOT IN ('local', 'dev') THEN
    RAISE EXCEPTION 'db/seeds/dev-datoms-scope.sql is for APP_ENV=local or dev only (nexus.app_env is %)',
      coalesce(current_setting('nexus.app_env', true), 'unset');
  END IF;
END $$;

UPDATE core.setting SET value = '0.1'::jsonb, updated_at = now()
 WHERE key = 'budget.max_share' AND value = '1.0'::jsonb;

UPDATE core.setting SET value = '["43644","43514","43512","42426"]'::jsonb, updated_at = now()
 WHERE key = 'poll.subset_external_ids' AND value = 'null'::jsonb;
