-- =====================================================================
-- Nexus database roles and grants (least privilege)
-- Applied by `pnpm db:migrate` after every migration run, as the role nexus_migrator (which owns every
-- table and function, so it can grant on them). Everything here is idempotent. Because it is re-applied
-- after each run, a table added by a later migration gets its grants without extra work; a migration
-- that needs a table-specific grant adds the GRANT to this file.
-- In Azure, prefer Entra (managed identity) principals mapped to these roles.
-- Kept separate from schema.sql so `pnpm db:check` compares structure only.
-- =====================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexus_migrator') THEN CREATE ROLE nexus_migrator NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexus_api')      THEN CREATE ROLE nexus_api NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexus_worker')   THEN CREATE ROLE nexus_worker NOLOGIN; END IF;
END $$;

-- Migrator owns DDL
GRANT ALL ON SCHEMA core, access, telemetry, events, integration, audit TO nexus_migrator;

-- Both apps can read everything and use schemas/functions
GRANT USAGE ON SCHEMA core, access, telemetry, events, integration, audit TO nexus_api, nexus_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA core, access, telemetry, events, integration, audit TO nexus_api, nexus_worker;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA core, access, telemetry TO nexus_api, nexus_worker;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA core, access, telemetry, events, integration, audit TO nexus_api, nexus_worker;

-- API writes: access admin, read state, audit, admin-held fields, settings, linking
-- Users sign in (insert/update, never delete: deactivate with is_active). Roles, permissions and
-- role_permission are reference data changed only by migrations, so the API cannot grant itself rights.
GRANT INSERT, UPDATE ON access.app_user TO nexus_api;
GRANT INSERT, UPDATE, DELETE ON access.group_role, access.user_role, access.project_access TO nexus_api;
GRANT INSERT, UPDATE, DELETE ON events.event_read, events.read_marker TO nexus_api;           -- R-41 read state (docs/06 section 3, item 11)
GRANT INSERT ON audit.log TO nexus_api;
GRANT INSERT, UPDATE ON core.project, core.district, core.building, core.level, core.zone TO nexus_api;  -- R-63 admin projects
GRANT UPDATE (project_id, asset_type_id, building_id, level_id, zone_id) ON core.asset TO nexus_api;    -- assign/link assets (not `kind`: set by the connector, ADR 0009)
GRANT INSERT, UPDATE ON core.asset_type, core.setting, core.feature_flag TO nexus_api;              -- incl. asset_type.poll_interval_seconds (ADR 0006)
GRANT INSERT, UPDATE, DELETE ON telemetry.status_map TO nexus_api;
GRANT UPDATE (display_name, unit, category, is_hidden) ON telemetry.parameter TO nexus_api;           -- fill gaps only
GRANT UPDATE ON integration.link_todo TO nexus_api;

-- Worker writes: synced data, telemetry, events, integration bookkeeping, partitions
GRANT INSERT, UPDATE ON core.project, core.asset, core.asset_type TO nexus_worker;
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA telemetry TO nexus_worker;
GRANT INSERT, UPDATE ON ALL TABLES IN SCHEMA events TO nexus_worker;
REVOKE INSERT, UPDATE ON events.event_read, events.read_marker FROM nexus_worker;               -- per-user read state is API-only
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA integration TO nexus_worker;
-- Partition maintenance (create/drop partitions) runs as nexus_worker through
-- core.create_range_partitions / core.drop_partitions_before. Those functions are owned by
-- nexus_migrator, SECURITY DEFINER with a pinned search_path (see db/schema.sql), and only
-- nexus_worker may execute them. New functions are executable by PUBLIC unless revoked.
REVOKE EXECUTE ON FUNCTION core.create_range_partitions(text, text, date, int),
                           core.drop_partitions_before(text, timestamptz)
  FROM PUBLIC, nexus_api;
GRANT EXECUTE ON FUNCTION core.create_range_partitions(text, text, date, int),
                          core.drop_partitions_before(text, timestamptz)
  TO nexus_worker;

-- Future tables get the same defaults
ALTER DEFAULT PRIVILEGES FOR ROLE nexus_migrator IN SCHEMA core, access, telemetry, events, integration, audit
  GRANT SELECT ON TABLES TO nexus_api, nexus_worker;
