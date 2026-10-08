-- =====================================================================
-- Nexus database roles and grants (least privilege)
-- Run once per environment by an admin / the migrator, AFTER the schema exists.
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
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA access TO nexus_api;
GRANT INSERT, UPDATE, DELETE ON events.event_read TO nexus_api;
GRANT INSERT ON audit.log TO nexus_api;
GRANT INSERT, UPDATE ON core.project, core.district, core.building, core.level, core.zone TO nexus_api;  -- R-63 admin projects
GRANT UPDATE (project_id, asset_type_id, building_id, level_id, zone_id) ON core.asset TO nexus_api;    -- assign/link assets
GRANT INSERT, UPDATE ON core.asset_type, core.setting, core.feature_flag TO nexus_api;
GRANT INSERT, UPDATE, DELETE ON telemetry.status_map TO nexus_api;
GRANT UPDATE (display_name, unit, category, is_hidden) ON telemetry.parameter TO nexus_api;           -- fill gaps only
GRANT UPDATE ON integration.link_todo TO nexus_api;

-- Worker writes: synced data, telemetry, events, integration bookkeeping, partitions
GRANT INSERT, UPDATE ON core.project, core.asset, core.asset_type TO nexus_worker;
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA telemetry TO nexus_worker;
GRANT INSERT, UPDATE ON ALL TABLES IN SCHEMA events TO nexus_worker;
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA integration TO nexus_worker;
-- Partition maintenance (create/drop partitions) runs as nexus_worker through
-- core.create_range_partitions / core.drop_partitions_before. Those functions must be
-- owned by nexus_migrator and declared SECURITY DEFINER in the migration, with
-- search_path pinned; grant EXECUTE on them to nexus_worker only.

-- Future tables get the same defaults
ALTER DEFAULT PRIVILEGES FOR ROLE nexus_migrator IN SCHEMA core, access, telemetry, events, integration, audit
  GRANT SELECT ON TABLES TO nexus_api, nexus_worker;
