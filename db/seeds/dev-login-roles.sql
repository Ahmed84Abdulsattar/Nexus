-- =====================================================================
-- Local-only LOGIN users for the app roles in db/roles.sql
-- ---------------------------------------------------------------------
-- APP_ENV=local ONLY. `pnpm db:seed` runs this file only when APP_ENV=local, and the file also refuses
-- to run anywhere else: the runner sets `SET nexus.app_env = '<APP_ENV>'` first, and anything other
-- than 'local' (or unset) raises before a role is touched. In dev and prod the apps sign in with Entra
-- (managed identity) principals mapped to these roles (docs/06 section 9); there are no such users there.
--
-- Creates (or re-asserts):
--   nexus_api_local     LOGIN, member of nexus_api     -> the api's DATABASE_URL locally (docs/04)
--   nexus_worker_local  LOGIN, member of nexus_worker  -> the worker's DATABASE_URL locally
-- No password: local Postgres trusts loopback connections only (docker-compose.yml, scripts/pg-local.ps1).
-- Each user has exactly its role's grants and nothing else, so a missing grant fails locally the same
-- way it would in Azure, instead of being hidden by a superuser connection.
--
-- Run after db/roles.sql (the roles must exist), as a role that can create roles (locally the
-- superuser `nexus`). Safe to run again.
-- =====================================================================
DO $$
BEGIN
  IF current_setting('nexus.app_env', true) IS DISTINCT FROM 'local' THEN
    RAISE EXCEPTION 'db/seeds/dev-login-roles.sql is for APP_ENV=local only (nexus.app_env is %)',
      coalesce(current_setting('nexus.app_env', true), 'unset');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexus_api')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexus_worker') THEN
    RAISE EXCEPTION 'nexus_api / nexus_worker not found: run db/roles.sql first';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexus_api_local')    THEN CREATE ROLE nexus_api_local; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexus_worker_local') THEN CREATE ROLE nexus_worker_local; END IF;

  -- Re-asserted on every run, in case someone changed them by hand.
  ALTER ROLE nexus_api_local    LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD NULL;
  ALTER ROLE nexus_worker_local LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD NULL;
  GRANT nexus_api    TO nexus_api_local;
  GRANT nexus_worker TO nexus_worker_local;
END $$;
