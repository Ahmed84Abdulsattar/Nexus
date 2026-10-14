-- =====================================================================
-- Nexus database roles and grants (least privilege)
-- Applied by `pnpm db:migrate` after every migration run, as the role nexus_migrator (which owns every
-- table and function, so it can grant on them). Everything here is idempotent. Because it is re-applied
-- after each run, a table added by a later migration gets its grants without extra work; a migration
-- that needs a table-specific grant adds the GRANT to this file.
-- In Azure, prefer Entra (managed identity) principals mapped to these roles.
-- Kept separate from schema.sql so `pnpm db:check` compares structure only.
--
-- Rules this file keeps:
--   * No default privileges for tables or functions. Partitions that the worker creates at run time
--     therefore get NO grants of their own (access goes through the parent table), and a new function
--     is executable by nobody until it is granted here.
--   * Functions are granted one by one, never "ALL FUNCTIONS" (a future SECURITY DEFINER function must
--     not become callable by the API).
-- =====================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexus_migrator') THEN CREATE ROLE nexus_migrator NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexus_api')      THEN CREATE ROLE nexus_api NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexus_worker')   THEN CREATE ROLE nexus_worker NOLOGIN; END IF;
END $$;

-- Migrator owns DDL
GRANT ALL ON SCHEMA core, access, telemetry, events, integration, audit TO nexus_migrator;

-- Nothing is granted by default: remove what an older version of this file granted.
ALTER DEFAULT PRIVILEGES FOR ROLE nexus_migrator IN SCHEMA core, access, telemetry, events, integration, audit
  REVOKE SELECT ON TABLES FROM nexus_api, nexus_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE nexus_migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ---------------------------------------------------------------------
-- Functions: explicit grants. PUBLIC loses EXECUTE on every function in the Nexus schemas first.
-- Trigger functions (core.touch_updated_at, access.notify_access_change) need no grant.
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA core, access, telemetry FROM PUBLIC, nexus_api, nexus_worker;
-- API: who has which roles and projects (docs/06 section 5).
GRANT EXECUTE ON FUNCTION access.user_roles(uuid, uuid[]), access.user_project_ids(uuid, uuid[]) TO nexus_api;
-- Worker: rollups (SECURITY INVOKER: they write with the worker's own INSERT rights) and partition
-- maintenance (SECURITY DEFINER with a pinned search_path, owned by nexus_migrator, see db/schema.sql).
GRANT EXECUTE ON FUNCTION telemetry.refresh_rollup_5m(timestamptz, timestamptz),
                          telemetry.refresh_rollup_combine(regclass, regclass, interval, timestamptz, timestamptz, text),
                          core.create_range_partitions(text, text, date, int),
                          core.drop_partitions_before(text, timestamptz)
  TO nexus_worker;

-- ---------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------
GRANT USAGE ON SCHEMA core, access, telemetry, events, integration, audit TO nexus_api;
GRANT USAGE ON SCHEMA core, telemetry, events, integration TO nexus_worker;
REVOKE USAGE ON SCHEMA access, audit FROM nexus_worker;       -- the worker has no business with users or the audit log
GRANT SELECT ON ALL TABLES IN SCHEMA core, access, telemetry, events, integration, audit TO nexus_api;
GRANT SELECT ON ALL TABLES IN SCHEMA core, telemetry, events, integration TO nexus_worker;
REVOKE ALL ON ALL TABLES IN SCHEMA access, audit FROM nexus_worker;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA core, access, telemetry, events, integration, audit TO nexus_api;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA core, telemetry, events, integration TO nexus_worker;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA access, audit FROM nexus_worker;

-- ---------------------------------------------------------------------
-- API writes: access admin, read state, audit, admin-held fields, settings, linking
-- ---------------------------------------------------------------------
-- Users sign in (insert/update, never delete: deactivate with is_active). Roles, permissions and
-- role_permission are reference data changed only by migrations, so the API cannot grant itself rights.
GRANT INSERT, UPDATE ON access.app_user TO nexus_api;
GRANT INSERT, UPDATE, DELETE ON access.group_role, access.user_role, access.project_access TO nexus_api;
GRANT INSERT, UPDATE, DELETE ON events.event_read, events.read_marker TO nexus_api;           -- R-41 read state (docs/06 section 3, item 11)
GRANT INSERT ON audit.log TO nexus_api;
-- R-63 admin projects. New rows may be inserted (an admin-created project or spatial row carries its
-- own identity), but UPDATE is limited to the admin-held columns: source identity (source_system,
-- external_id, source_payload), *_seen_at, created_at and (for projects) retired_at belong to the
-- connector (CLAUDE.md rule 8).
GRANT INSERT ON core.project, core.district, core.building, core.level, core.zone TO nexus_api;
GRANT UPDATE (name, code, state, state_origin, project_type, district_id, address, latitude, longitude,
              boundary, timezone, client_name, consultant_name, manager_name) ON core.project TO nexus_api;
GRANT UPDATE (name, emirate) ON core.district TO nexus_api;
GRANT UPDATE (name, code, bim_ref, retired_at) ON core.building TO nexus_api;
GRANT UPDATE (name, elevation_m, sort_order, bim_ref, retired_at) ON core.level TO nexus_api;
GRANT UPDATE (level_id, name, kind, boundary, bim_ref, retired_at) ON core.zone TO nexus_api;
GRANT UPDATE (project_id, asset_type_id, building_id, level_id, zone_id) ON core.asset TO nexus_api;    -- assign/link assets (not `kind`: set by the connector, ADR 0009)
GRANT INSERT, UPDATE ON core.asset_type, core.setting, core.feature_flag TO nexus_api;              -- incl. asset_type.poll_interval_seconds (ADR 0006)
GRANT INSERT, UPDATE, DELETE ON telemetry.status_map TO nexus_api;
GRANT UPDATE (display_name, unit, category, is_hidden) ON telemetry.parameter TO nexus_api;           -- fill gaps only
GRANT UPDATE ON integration.link_todo TO nexus_api;

-- ---------------------------------------------------------------------
-- Worker writes: synced data, telemetry, events, integration bookkeeping. No DELETE except where a job needs it.
-- ---------------------------------------------------------------------
GRANT INSERT, UPDATE ON core.project, core.asset, core.asset_type TO nexus_worker;
GRANT INSERT, UPDATE ON ALL TABLES IN SCHEMA telemetry TO nexus_worker;
REVOKE INSERT, UPDATE ON telemetry.status_map FROM nexus_worker;       -- display mapping is managed by admins (API)
GRANT INSERT, UPDATE ON events.event TO nexus_worker;                  -- NOT the read-state tables (events.event_read and its partitions)
GRANT INSERT, UPDATE ON ALL TABLES IN SCHEMA integration TO nexus_worker;
GRANT DELETE ON integration.sync_run TO nexus_worker;                  -- maintenance prunes old run history
-- Per-user read state is API-only. The partitions of events.event_read are separate tables: the worker
-- gets nothing on them, not even SELECT. (Partitions created later by core.create_range_partitions get
-- no grants at all, because there are no default privileges.)
REVOKE ALL ON events.event_read, events.read_marker FROM nexus_worker;
DO $$
DECLARE child regclass;
BEGIN
  FOR child IN
    SELECT i.inhrelid::regclass FROM pg_inherits i WHERE i.inhparent = 'events.event_read'::regclass
  LOOP
    EXECUTE format('REVOKE ALL ON %s FROM nexus_worker', child);
  END LOOP;
END $$;
