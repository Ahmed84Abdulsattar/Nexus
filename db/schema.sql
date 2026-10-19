-- =====================================================================
-- Nexus by Innovo — reference database schema (PostgreSQL 16)
-- ---------------------------------------------------------------------
-- This file is the TARGET STATE. Migrations in db/migrations must produce
-- exactly this. Explained in docs/06-database.md.
--
-- Runs on: Azure Database for PostgreSQL Flexible Server 16, and on-prem
-- PostgreSQL 16. Only extension: pg_trgm (standard contrib, allowed on Azure). Time series = native
-- partitioning + Nexus rollup tables (see docs/adr/0003, amended by docs/adr/0007).
--
-- Schemas
--   core         organisations, projects, spatial (BIM-ready), assets, settings
--   access       users, roles, permissions, Entra group mappings, project access
--   telemetry    parameter dictionary, latest + raw packets, rollups, status, location
--   events       alerts / notifications as reported by the source, read state
--   integration  sync runs, API call log, linking to-do, cursors
--   audit        audit log
--
-- Conventions
--   * snake_case, singular table names, uuid primary keys (app may send uuid v7)
--   * every synced row: source_system + external_id (unique together)
--   * all times timestamptz in UTC; display in Asia/Dubai
--   * never delete synced business rows: set retired_at
--   * values, statuses and alerts are stored AS THE SOURCE REPORTS THEM
-- =====================================================================

-- Fast "contains" search on names (Azure: allow-list PG_TRGM in azure.extensions first)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS access;
CREATE SCHEMA IF NOT EXISTS telemetry;
CREATE SCHEMA IF NOT EXISTS events;
CREATE SCHEMA IF NOT EXISTS integration;
CREATE SCHEMA IF NOT EXISTS audit;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Partition maintenance. SECURITY DEFINER: creating or dropping a partition needs ownership of the
-- parent table, which the app roles (nexus_worker) do not have. The functions run as their owner
-- (nexus_migrator, the owner of every table) and therefore:
--   * pin search_path, so nothing can be shadowed;
--   * accept only partitioned tables in the telemetry, events, integration and audit schemas;
--   * are executable by nexus_worker only (db/roles.sql revokes them from PUBLIC and nexus_api).
-- Partition bounds are UTC midnights, whatever the caller's TimeZone setting.
--
-- Create range partitions for a partitioned table.
--   p_parent  'telemetry.packet'
--   p_step    'day' | 'month'
--   p_from    first period start (date)
--   p_count   number of periods (1 to 400)
-- Partition name: <table>_pYYYYMMDD (day) or <table>_pYYYYMM (month)
CREATE OR REPLACE FUNCTION core.create_range_partitions(
  p_parent text, p_step text, p_from date, p_count int
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_schema text := split_part(p_parent, '.', 1);
  v_table  text := split_part(p_parent, '.', 2);
  v_start  date;
  v_end    date;
  v_name   text;
  v_made   int := 0;
BEGIN
  IF p_step NOT IN ('day', 'month') THEN
    RAISE EXCEPTION 'p_step must be day or month';
  END IF;
  IF p_count IS NULL OR p_count < 1 OR p_count > 400 THEN
    RAISE EXCEPTION 'p_count must be between 1 and 400';
  END IF;
  IF v_schema NOT IN ('telemetry', 'events', 'integration', 'audit') OR NOT EXISTS (
       SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = v_schema AND c.relname = v_table AND c.relkind = 'p') THEN
    RAISE EXCEPTION '% is not a partitioned table that Nexus maintains', p_parent;
  END IF;
  v_start := CASE p_step WHEN 'day' THEN p_from ELSE date_trunc('month', p_from)::date END;
  FOR i IN 1..p_count LOOP
    v_end  := CASE p_step WHEN 'day' THEN v_start + 1 ELSE (v_start + interval '1 month')::date END;
    v_name := v_table || '_p' || to_char(v_start, CASE p_step WHEN 'day' THEN 'YYYYMMDD' ELSE 'YYYYMM' END);
    IF to_regclass(format('%I.%I', v_schema, v_name)) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE %I.%I PARTITION OF %I.%I FOR VALUES FROM (%L) TO (%L)',
        v_schema, v_name, v_schema, v_table,
        v_start::timestamp AT TIME ZONE 'UTC', v_end::timestamp AT TIME ZONE 'UTC');
      v_made := v_made + 1;
    END IF;
    v_start := v_end;
  END LOOP;
  RETURN v_made;
END $$;

-- Drop partitions whose upper bound is <= p_before. Returns names dropped.
-- Archive to Blob (Parquet) BEFORE calling this if archiving is enabled.
-- Guards (the worker is trusted to run maintenance, not to destroy history):
--   * p_before may not be in the future, so a wrong argument cannot drop the live partitions;
--   * audit.log, events.event and events.event_read keep at least 730 days, whatever the argument
--     (the settings retention.audit_days / retention.event_days default to 730; shortening them
--     needs a migration that changes this floor);
--   * every dropped partition is written to audit.log, inside this function.
CREATE OR REPLACE FUNCTION core.drop_partitions_before(p_parent text, p_before timestamptz)
RETURNS SETOF text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_schema text := split_part(p_parent, '.', 1);
  v_table  text := split_part(p_parent, '.', 2);
  r record;
  v_upper timestamptz;
BEGIN
  IF p_before IS NULL OR p_before > now() THEN
    RAISE EXCEPTION 'p_before must not be in the future';
  END IF;
  IF (v_schema = 'audit' OR (v_schema = 'events' AND v_table IN ('event', 'event_read')))
     AND p_before > now() - interval '730 days' THEN
    RAISE EXCEPTION '% keeps at least 730 days; p_before is too recent', p_parent;
  END IF;
  IF v_schema NOT IN ('telemetry', 'events', 'integration', 'audit') OR NOT EXISTS (
       SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = v_schema AND c.relname = v_table AND c.relkind = 'p') THEN
    RAISE EXCEPTION '% is not a partitioned table that Nexus maintains', p_parent;
  END IF;
  FOR r IN
    SELECT c.oid::regclass::text AS part, pg_get_expr(c.relpartbound, c.oid) AS bound
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    WHERE i.inhparent = format('%I.%I', v_schema, v_table)::regclass
  LOOP
    v_upper := substring(r.bound FROM 'TO \(''([^'']+)''\)')::timestamptz;
    IF v_upper IS NOT NULL AND v_upper <= p_before THEN
      EXECUTE format('DROP TABLE %s', r.part);
      INSERT INTO audit.log (action, target_type, target_id, details)
      VALUES ('maintenance.partition_dropped', 'partition', r.part,
              jsonb_build_object('parent', format('%I.%I', v_schema, v_table),
                                 'before', p_before, 'upper_bound', v_upper, 'caller', session_user));
      RETURN NEXT r.part;
    END IF;
  END LOOP;
END $$;

-- =====================================================================
-- CORE
-- =====================================================================

-- Key/value settings (retention, poll interval, timezone…). Read by api + worker.
CREATE TABLE core.setting (
  key          text PRIMARY KEY,
  value        jsonb NOT NULL,
  description  text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Feature flags for future slots (weather, manpower, materials, gallery, bim…)
CREATE TABLE core.feature_flag (
  key          text PRIMARY KEY,
  enabled      boolean NOT NULL DEFAULT false,
  description  text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Data sources. Phase 1: 'datoms'. Later: 'hse', 'materials', 'weather', …
CREATE TABLE core.source_system (
  code         text PRIMARY KEY,
  name         text NOT NULL,
  enabled      boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE core.district (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  emirate      text,
  UNIQUE (name, emirate)
);

-- A project = an Innovo site (DATOMS "site"/"territory"; one per construction project or store)
CREATE TABLE core.project (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  code            text,                                   -- Innovo project code if provided
  -- Portfolio map colour. From the source when available; else set by an admin.
  state           text NOT NULL DEFAULT 'unknown'
                  CHECK (state IN ('active','central_store','finished','in_bid','unknown')),
  state_origin    text NOT NULL DEFAULT 'source' CHECK (state_origin IN ('source','admin')),
  project_type    text,                                   -- as reported (e.g. residential, infra)
  district_id     uuid REFERENCES core.district(id),
  address         text,
  latitude        numeric(9,6) CHECK (latitude  BETWEEN -90  AND 90),
  longitude       numeric(9,6) CHECK (longitude BETWEEN -180 AND 180),
  boundary        jsonb,                                  -- optional GeoJSON polygon of the site
  timezone        text NOT NULL DEFAULT 'Asia/Dubai',
  -- future project details (admin-held if the source lacks them)
  client_name     text,
  consultant_name text,
  manager_name    text,
  -- source link
  source_system   text NOT NULL REFERENCES core.source_system(code),
  external_id     text NOT NULL,
  source_payload  jsonb,                                  -- raw source record for traceability
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  retired_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_system, external_id)
);
CREATE INDEX project_state_idx    ON core.project (state) WHERE retired_at IS NULL;
CREATE INDEX project_district_idx ON core.project (district_id);
CREATE INDEX project_name_trgm_idx ON core.project USING gin (name gin_trgm_ops);   -- search: name ILIKE '%text%'
CREATE TRIGGER project_touch BEFORE UPDATE ON core.project
  FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

-- ---- Spatial hierarchy (BIM-ready). Nullable links on assets/events. ----
-- source_system + external_id: set when a source (BIM, another platform) feeds the row; NULL when
-- an admin created it. retired_at: never delete (CLAUDE.md rule 8).
CREATE TABLE core.building (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES core.project(id),
  name          text NOT NULL,
  code          text,
  bim_ref       jsonb,          -- e.g. {"ifcGuid": "...", "apsUrn": "...", "i3sLayer": "..."}
  source_system text REFERENCES core.source_system(code),
  external_id   text,
  retired_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name),
  UNIQUE (source_system, external_id),
  UNIQUE (id, project_id)         -- target of core.asset's (building_id, project_id) foreign key
);
CREATE TABLE core.level (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id   uuid NOT NULL REFERENCES core.building(id),
  name          text NOT NULL,
  elevation_m   numeric(8,2),
  sort_order    int NOT NULL DEFAULT 0,
  bim_ref       jsonb,
  source_system text REFERENCES core.source_system(code),
  external_id   text,
  retired_at    timestamptz,
  UNIQUE (building_id, name),
  UNIQUE (source_system, external_id),
  UNIQUE (id, building_id)        -- target of core.asset's (level_id, building_id) foreign key
);
CREATE TABLE core.zone (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES core.project(id),
  level_id      uuid REFERENCES core.level(id),
  name          text NOT NULL,
  kind          text,           -- as reported, e.g. 'laydown', 'gate', 'room'
  boundary      jsonb,          -- GeoJSON polygon
  bim_ref       jsonb,
  source_system text REFERENCES core.source_system(code),
  external_id   text,
  retired_at    timestamptz,
  UNIQUE (project_id, name),
  UNIQUE (source_system, external_id),
  UNIQUE (id, project_id)         -- target of core.asset's (zone_id, project_id) foreign key
);

-- ---- Asset types. Maps source type names to an icon/category. ----
-- New source types are inserted automatically as 'generic' until an admin maps them.
-- source_names holds source type names exactly as core.asset.source_type_name stores them. The DATOMS
-- category names are appended by db/seeds/datoms-parameters.sql (docs/adr/0011), not hard-coded here.
CREATE TABLE core.asset_type (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,     -- tower_crane, hoist, diesel_generator, fuel_tank, solar, mains, forklift, …
  display_name  text NOT NULL,
  category      text NOT NULL CHECK (category IN ('equipment','energy','vehicle','environment','other')),
  icon          text NOT NULL DEFAULT 'generic',
  source_names  text[] NOT NULL DEFAULT '{}',  -- e.g. {'Solar Inverter'} as DATOMS names the category
  -- Poll interval for assets of this type (docs/adr/0006). NULL = setting poll.interval_seconds (60).
  -- Set by an admin only if the credit allowance requires it (open question Q14).
  poll_interval_seconds int CHECK (poll_interval_seconds IS NULL OR poll_interval_seconds >= 60),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---- Assets: every sensored item on site ----
-- Spatial links (BIM-ready): project_id, then optional building_id, level_id, zone_id. The two CHECKs
-- and three composite foreign keys keep them consistent: a building or zone belongs to the asset's
-- own project, a level to the asset's own building, and nothing is linked without a project.
-- project_id stays NULL only for a source asset not yet linked to a project (integration.link_todo);
-- such an asset is not shown anywhere project-scoped.
CREATE TABLE core.asset (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid REFERENCES core.project(id),     -- null until linked (see integration.link_todo)
  asset_type_id    uuid REFERENCES core.asset_type(id),
  building_id      uuid REFERENCES core.building(id),
  level_id         uuid REFERENCES core.level(id),
  zone_id          uuid REFERENCES core.zone(id),
  -- docs/adr/0009: 'physical' = a physical sensored item of any category (incl. DGs, solar, mains);
  -- 'site_metric' = values for a whole site as the source reports them (e.g. energy site totals).
  -- Every equipment list, count, map layer and view filters kind = 'physical'.
  -- Set by the connector from source data (rule lives in packages/datoms-client/src/mapping.ts).
  kind             text NOT NULL DEFAULT 'physical' CHECK (kind IN ('physical','site_metric')),
  name             text NOT NULL,
  source_type_name text,                                   -- type (DATOMS: asset category) exactly as the source names it;
                                                           -- also the key into telemetry.parameter (docs/adr/0011)
  make             text,
  model            text,
  serial_no        text,
  rated_kva        numeric,
  capacity         text,
  ownership        text CHECK (ownership IN ('owned','hired')),  -- only if the source provides it
  asset_info       jsonb NOT NULL DEFAULT '{}'::jsonb,     -- full nameplate from the source (extra columns)
  source_system    text NOT NULL REFERENCES core.source_system(code),
  external_id      text NOT NULL,                          -- DATOMS asset id, e.g. '36390'
  source_created_at timestamptz,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  retired_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- DATOMS lifecycle_status exactly as reported. Display only: never used for status, counts, poll scope or
  -- retirement. Added by the catalogue_sync_details migration, so it is the last column (pg_dump lists columns in creation order).
  source_lifecycle_status text,
  UNIQUE (source_system, external_id),
  CONSTRAINT asset_spatial_needs_project_chk
    CHECK (project_id IS NOT NULL OR (building_id IS NULL AND level_id IS NULL AND zone_id IS NULL)),
  CONSTRAINT asset_level_needs_building_chk
    CHECK (level_id IS NULL OR building_id IS NOT NULL),
  CONSTRAINT asset_building_project_fk FOREIGN KEY (building_id, project_id) REFERENCES core.building (id, project_id),
  CONSTRAINT asset_level_building_fk   FOREIGN KEY (level_id, building_id)   REFERENCES core.level (id, building_id),
  CONSTRAINT asset_zone_project_fk     FOREIGN KEY (zone_id, project_id)     REFERENCES core.zone (id, project_id)
);
CREATE INDEX asset_project_idx ON core.asset (project_id) WHERE retired_at IS NULL;
CREATE INDEX asset_type_idx    ON core.asset (asset_type_id);
CREATE INDEX asset_zone_idx    ON core.asset (zone_id) WHERE zone_id IS NOT NULL;
CREATE INDEX asset_name_trgm_idx ON core.asset USING gin (name gin_trgm_ops);      -- search: name ILIKE '%text%'
CREATE TRIGGER asset_touch BEFORE UPDATE ON core.asset
  FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

-- =====================================================================
-- ACCESS
-- =====================================================================
CREATE TABLE access.app_user (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entra_oid     uuid NOT NULL UNIQUE,     -- 'oid' claim
  tenant_id     uuid NOT NULL,            -- 'tid' claim
  email         text,
  display_name  text,
  job_title     text,
  is_active     boolean NOT NULL DEFAULT true,
  last_seen_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE access.role (
  code             text PRIMARY KEY,      -- admin, leadership, project_manager, site_user, viewer
  name             text NOT NULL,
  description      text,
  all_projects     boolean NOT NULL DEFAULT false,  -- true: sees every project without assignment
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE access.permission (
  key          text PRIMARY KEY,          -- 'project.read', 'admin.users.manage', … (packages/shared/permissions.ts)
  description  text NOT NULL
);

CREATE TABLE access.role_permission (
  role_code       text NOT NULL REFERENCES access.role(code) ON DELETE CASCADE,
  permission_key  text NOT NULL REFERENCES access.permission(key) ON DELETE CASCADE,
  PRIMARY KEY (role_code, permission_key)
);

-- Entra security group → Nexus role (managed in Admin)
CREATE TABLE access.group_role (
  entra_group_id  uuid NOT NULL,
  role_code       text NOT NULL REFERENCES access.role(code) ON DELETE CASCADE,
  group_name      text,
  created_by      uuid REFERENCES access.app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entra_group_id, role_code)
);

-- Optional direct role for a user (break-glass admin, exceptions)
CREATE TABLE access.user_role (
  user_id     uuid NOT NULL REFERENCES access.app_user(id) ON DELETE CASCADE,
  role_code   text NOT NULL REFERENCES access.role(code) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_code)
);

-- Project scope: a user or an Entra group is granted a project
CREATE TABLE access.project_access (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES core.project(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES access.app_user(id) ON DELETE CASCADE,
  entra_group_id  uuid,
  granted_by      uuid REFERENCES access.app_user(id),
  granted_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((user_id IS NOT NULL) <> (entra_group_id IS NOT NULL))
);
CREATE UNIQUE INDEX project_access_user_uq  ON access.project_access (project_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX project_access_group_uq ON access.project_access (project_id, entra_group_id) WHERE entra_group_id IS NOT NULL;
CREATE INDEX project_access_user_idx  ON access.project_access (user_id);
CREATE INDEX project_access_group_idx ON access.project_access (entra_group_id);

-- Effective roles for a user given the group ids from their token
CREATE OR REPLACE FUNCTION access.user_roles(p_user_id uuid, p_group_ids uuid[])
RETURNS SETOF text LANGUAGE sql STABLE AS $$
  SELECT role_code FROM access.user_role WHERE user_id = p_user_id
  UNION
  SELECT role_code FROM access.group_role WHERE entra_group_id = ANY (p_group_ids)
$$;

-- Effective project ids. Returns NULL row set + all_projects flag handled in app:
-- if any role has all_projects, the API skips the filter.
CREATE OR REPLACE FUNCTION access.user_project_ids(p_user_id uuid, p_group_ids uuid[])
RETURNS SETOF uuid LANGUAGE sql STABLE AS $$
  SELECT project_id FROM access.project_access WHERE user_id = p_user_id
  UNION
  SELECT project_id FROM access.project_access WHERE entra_group_id = ANY (p_group_ids)
$$;

-- Access changes reach every API instance at once (docs/08 section 2, S1-01 step 6).
-- Every change that can alter a user's roles, permissions, project scope or active flag sends a
-- NOTIFY on channel 'nexus_access' when its transaction commits. Each API instance LISTENs and drops
-- the affected cache entries. Payload (small JSON):
--   {"scope":"user","userId":"<app_user.id>"}   one user is affected
--   {"scope":"all"}                             many users may be affected (a group, role or permission changed)
-- Triggers (not application code) so that a change made by any writer, including a manual SQL fix,
-- is announced. Identical notifications inside one transaction are delivered once.
CREATE OR REPLACE FUNCTION access.notify_access_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_row     jsonb;
  v_payload jsonb;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN   -- statement trigger: no rows; everybody may be affected
    PERFORM pg_notify('nexus_access', '{"scope":"all"}');
    RETURN NULL;
  END IF;
  FOR v_row IN
    SELECT r FROM unnest(ARRAY[
      CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
      CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END
    ]) AS r WHERE r IS NOT NULL
  LOOP
    v_payload := CASE
      WHEN TG_TABLE_NAME = 'user_role'      THEN jsonb_build_object('scope', 'user', 'userId', v_row->>'user_id')
      WHEN TG_TABLE_NAME = 'app_user'       THEN jsonb_build_object('scope', 'user', 'userId', v_row->>'id')
      WHEN TG_TABLE_NAME = 'project_access' AND v_row->>'user_id' IS NOT NULL
                                            THEN jsonb_build_object('scope', 'user', 'userId', v_row->>'user_id')
      ELSE jsonb_build_object('scope', 'all')   -- group_role, role, role_permission, permission, group project access
    END;
    PERFORM pg_notify('nexus_access', v_payload::text);
  END LOOP;
  RETURN NULL;
END $$;

CREATE TRIGGER user_role_notify        AFTER INSERT OR UPDATE OR DELETE ON access.user_role
  FOR EACH ROW EXECUTE FUNCTION access.notify_access_change();
CREATE TRIGGER group_role_notify       AFTER INSERT OR UPDATE OR DELETE ON access.group_role
  FOR EACH ROW EXECUTE FUNCTION access.notify_access_change();
CREATE TRIGGER project_access_notify   AFTER INSERT OR UPDATE OR DELETE ON access.project_access
  FOR EACH ROW EXECUTE FUNCTION access.notify_access_change();
CREATE TRIGGER role_notify             AFTER INSERT OR UPDATE OR DELETE ON access.role
  FOR EACH ROW EXECUTE FUNCTION access.notify_access_change();
CREATE TRIGGER role_permission_notify  AFTER INSERT OR UPDATE OR DELETE ON access.role_permission
  FOR EACH ROW EXECUTE FUNCTION access.notify_access_change();
CREATE TRIGGER permission_notify       AFTER INSERT OR UPDATE OR DELETE ON access.permission
  FOR EACH ROW EXECUTE FUNCTION access.notify_access_change();
-- app_user: only a change of the active flag (sign-in updates last_seen_at and must not notify), or a delete.
CREATE TRIGGER app_user_active_notify  AFTER UPDATE OF is_active ON access.app_user
  FOR EACH ROW WHEN (OLD.is_active IS DISTINCT FROM NEW.is_active)
  EXECUTE FUNCTION access.notify_access_change();
CREATE TRIGGER app_user_delete_notify  AFTER DELETE ON access.app_user
  FOR EACH ROW EXECUTE FUNCTION access.notify_access_change();
-- TRUNCATE fires no row triggers: announce it too. (To remove a user, set is_active = false; do not delete the row.)
CREATE TRIGGER user_role_truncate_notify       AFTER TRUNCATE ON access.user_role
  FOR EACH STATEMENT EXECUTE FUNCTION access.notify_access_change();
CREATE TRIGGER group_role_truncate_notify      AFTER TRUNCATE ON access.group_role
  FOR EACH STATEMENT EXECUTE FUNCTION access.notify_access_change();
CREATE TRIGGER project_access_truncate_notify  AFTER TRUNCATE ON access.project_access
  FOR EACH STATEMENT EXECUTE FUNCTION access.notify_access_change();
CREATE TRIGGER role_truncate_notify            AFTER TRUNCATE ON access.role
  FOR EACH STATEMENT EXECUTE FUNCTION access.notify_access_change();
CREATE TRIGGER role_permission_truncate_notify AFTER TRUNCATE ON access.role_permission
  FOR EACH STATEMENT EXECUTE FUNCTION access.notify_access_change();
CREATE TRIGGER permission_truncate_notify      AFTER TRUNCATE ON access.permission
  FOR EACH STATEMENT EXECUTE FUNCTION access.notify_access_change();
CREATE TRIGGER app_user_truncate_notify        AFTER TRUNCATE ON access.app_user
  FOR EACH STATEMENT EXECUTE FUNCTION access.notify_access_change();

-- =====================================================================
-- TELEMETRY
-- =====================================================================

-- Parameter dictionary, one row per (source, source asset type, key) (docs/adr/0011). The same key can
-- have a different name and unit per source type (e.g. DATOMS 'mpow_r' = "Mains L1 Active Power" on a
-- DG Set, "L1 Active Power" on an AC Sub-Meter), so names are never stored per key alone.
-- Filled from the source: auto-discovered from packet keys by the live poll, plus the DATOMS parameter
-- list in db/seeds/datoms-parameters.sql. Admin may set display name/unit only if the source does not
-- provide them (source values win).
-- Lookup for an asset's values: source_system = asset.source_system AND source_type_name IS NOT DISTINCT
-- FROM asset.source_type_name AND key = <value key>. No row = show the raw key, no unit. Never fall back
-- to the same key of another source type.
CREATE TABLE telemetry.parameter (
  id               serial PRIMARY KEY,
  source_system    text NOT NULL REFERENCES core.source_system(code),
  source_type_name text,                     -- asset type/category exactly as the source names it; equals
                                             -- core.asset.source_type_name. NULL = type not known yet (Q22)
  key              text NOT NULL,            -- e.g. 'hz', 'rpm', 'fuel'
  display_name     text,                     -- from source when available
  unit             text,                     -- from source when available
  data_type        text NOT NULL DEFAULT 'number' CHECK (data_type IN ('number','text','boolean','json')),
                                             -- seeded rows keep the default; the live poll sets it from the
                                             -- first value it sees (docs/adr/0011)
  category         text,                     -- parameter group as reported, e.g. 'electrical', 'engine'
                                             -- (not the asset category)
  is_hidden        boolean NOT NULL DEFAULT false,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parameter_source_type_key_uq UNIQUE NULLS NOT DISTINCT (source_system, source_type_name, key)
);

-- Which parameters each asset reports (filled automatically, used by explorer pickers).
-- parameter_id points at the dictionary row for the asset's own source type (docs/adr/0011).
-- Write rule (docs/06 section 4): INSERT only new (asset, parameter) pairs (the worker keeps the known
-- pairs in memory); refresh last_seen_at at most once a day. Never update it on every poll.
CREATE TABLE telemetry.asset_parameter (
  asset_id      uuid NOT NULL REFERENCES core.asset(id) ON DELETE CASCADE,
  parameter_id  int  NOT NULL REFERENCES telemetry.parameter(id),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (asset_id, parameter_id)
);

-- Latest packet per asset (live screens read only this). Updated every poll for every asset:
-- fillfactor leaves room on each page so updates stay HOT (no index churn).
CREATE TABLE telemetry.latest_packet (
  asset_id     uuid PRIMARY KEY REFERENCES core.asset(id) ON DELETE CASCADE,
  ts           timestamptz NOT NULL,         -- device-reported time (DATOMS data.time)
  values       jsonb NOT NULL,               -- {"hz":50.0,"rpm":1500,...} exactly as reported
  received_at  timestamptz NOT NULL DEFAULT now()
) WITH (fillfactor = 70);
ALTER TABLE telemetry.latest_packet ALTER COLUMN values SET COMPRESSION lz4;

-- Raw packets: one row per asset per device packet (~1/min). Daily partitions.
CREATE TABLE telemetry.packet (
  asset_id     uuid NOT NULL,                -- FK not enforced on partitioned hot table (worker guarantees)
  ts           timestamptz NOT NULL,
  values       jsonb NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (asset_id, ts)
) PARTITION BY RANGE (ts);
ALTER TABLE telemetry.packet ALTER COLUMN values SET COMPRESSION lz4;
-- For the closed-bucket rollup scans by time (docs/adr/0007). Candidate for BRIN instead of B-tree:
-- switch only with EXPLAIN ANALYZE evidence from the S2/S3 re-benchmark with real fixtures (docs/06 section 7).
CREATE INDEX packet_ts_idx ON telemetry.packet (ts);

-- Rollups. stats = {"<param key>": {"min":..,"max":..,"avg":..,"last":..,"n":..}, ...}
-- Only numeric parameters are rolled up. Computed by functions below (worker calls them once per
-- CLOSED bucket, docs/adr/0007). `packets` = samples Nexus stored in the bucket; the API reports it
-- as data coverage. A compact stats format is decided after the S2/S3 re-benchmark (docs/06 section 6a).
CREATE TABLE telemetry.rollup_5m (
  asset_id     uuid NOT NULL,
  bucket       timestamptz NOT NULL,
  stats        jsonb NOT NULL,
  packets      int NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (asset_id, bucket)
) PARTITION BY RANGE (bucket);
ALTER TABLE telemetry.rollup_5m ALTER COLUMN stats SET COMPRESSION lz4;

CREATE TABLE telemetry.rollup_1h (
  asset_id     uuid NOT NULL,
  bucket       timestamptz NOT NULL,
  stats        jsonb NOT NULL,
  packets      int NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (asset_id, bucket)
) PARTITION BY RANGE (bucket);
ALTER TABLE telemetry.rollup_1h ALTER COLUMN stats SET COMPRESSION lz4;

-- Daily buckets are LOCAL days of the project timezone (Asia/Dubai), stored as timestamptz.
-- Not partitioned: small (1 row per asset per day) and kept forever.
CREATE TABLE telemetry.rollup_1d (
  asset_id     uuid NOT NULL,
  bucket       timestamptz NOT NULL,
  stats        jsonb NOT NULL,
  packets      int NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (asset_id, bucket)
);
ALTER TABLE telemetry.rollup_1d ALTER COLUMN stats SET COMPRESSION lz4;

-- Status as the source reports it, plus mapping to the 4 display colours.
-- status_map rows translate source labels (e.g. DATOMS 'Running', 'Idle', 'Under Maintenance', 'Off')
-- to display buckets. Nexus never derives status from values.
CREATE TABLE telemetry.status_map (
  source_system   text NOT NULL REFERENCES core.source_system(code),
  source_value    text NOT NULL,
  display_status  text NOT NULL CHECK (display_status IN ('running','idle','maintenance','off','unknown')),
  PRIMARY KEY (source_system, source_value)
);

CREATE TABLE telemetry.asset_status_current (
  asset_id       uuid PRIMARY KEY REFERENCES core.asset(id) ON DELETE CASCADE,
  source_value   text NOT NULL,              -- exactly as reported
  since          timestamptz NOT NULL,       -- when this status started (source time if provided)
  observed_at    timestamptz NOT NULL,       -- when Nexus first observed this status. Written on CHANGE
                                             -- only, never every poll (latest_packet.received_at has the last poll)
  details        jsonb                       -- extra source status fields (fault codes, etc.)
) WITH (fillfactor = 80);

-- Status changes only, as OBSERVED BY NEXUS in polls (for "today's running timeline"; the UI labels it
-- "observed by Nexus", precision ~ one poll interval; docs/adr/0007)
CREATE TABLE telemetry.asset_status_history (
  asset_id      uuid NOT NULL,
  started_at    timestamptz NOT NULL,
  ended_at      timestamptz,
  source_value  text NOT NULL,
  PRIMARY KEY (asset_id, started_at)
) PARTITION BY RANGE (started_at);

-- Location (for assets the source locates: cranes fixed, vehicles moving)
CREATE TABLE telemetry.asset_location_current (
  asset_id     uuid PRIMARY KEY REFERENCES core.asset(id) ON DELETE CASCADE,
  latitude     numeric(9,6) NOT NULL,
  longitude    numeric(9,6) NOT NULL,
  altitude_m   numeric(8,2),
  heading_deg  numeric(5,2),
  observed_at  timestamptz NOT NULL
);
-- History only when position changes (worker skips identical points)
CREATE TABLE telemetry.asset_location_history (
  asset_id     uuid NOT NULL,
  observed_at  timestamptz NOT NULL,
  latitude     numeric(9,6) NOT NULL,
  longitude    numeric(9,6) NOT NULL,
  PRIMARY KEY (asset_id, observed_at)
) PARTITION BY RANGE (observed_at);

-- ---- Rollup functions (idempotent; safe to re-run for any window) ----
-- PHASE 1 PATH (docs/adr/0007, amends 0003): SQL only, no in-memory accumulators.
--   refresh_rollup_5m(bucket_start, bucket_end) runs ONCE per CLOSED 5-minute bucket, at
--   bucket end + rollup.close_grace_intervals x the current poll interval (default 2 x 60 s).
--   Late packets: re-run for the affected closed buckets only. Never a sliding window, never every minute.
-- refresh_rollup_combine() runs once per closed hour (1h, after the hour's last 5-min bucket) and once
-- per closed Dubai day (1d). In-memory rollups are a scale trigger in docs/12 section 2 (new ADR).
CREATE OR REPLACE FUNCTION telemetry.refresh_rollup_5m(p_from timestamptz, p_to timestamptz)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE v_rows int;
BEGIN
  p_from := date_bin('5 minutes', p_from, timestamptz '2000-01-01 00:00:00+00');
  INSERT INTO telemetry.rollup_5m AS r (asset_id, bucket, stats, packets)
  SELECT asset_id, bucket,
         jsonb_object_agg(k, jsonb_build_object('min', mn, 'max', mx, 'avg', av, 'last', lst, 'n', n)),
         max(pk)
  FROM (
    SELECT p.asset_id,
           date_bin('5 minutes', p.ts, timestamptz '2000-01-01 00:00:00+00') AS bucket,
           e.key AS k,
           min((e.value)::numeric)  AS mn,
           max((e.value)::numeric)  AS mx,
           round(avg((e.value)::numeric), 6) AS av,
           (array_agg((e.value)::numeric ORDER BY p.ts DESC))[1] AS lst,
           count(*) AS n,
           count(DISTINCT p.ts) AS pk
    FROM telemetry.packet p
    CROSS JOIN LATERAL jsonb_each(p.values) e
    WHERE p.ts >= p_from AND p.ts < p_to
      AND jsonb_typeof(e.value) = 'number'
    GROUP BY 1, 2, 3
  ) s
  GROUP BY asset_id, bucket
  ON CONFLICT (asset_id, bucket) DO UPDATE
    SET stats = EXCLUDED.stats, packets = EXCLUDED.packets, refreshed_at = now();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END $$;

-- Combine finer rollups into coarser ones (weighted average by n).
--   p_source 'telemetry.rollup_5m' -> p_target 'telemetry.rollup_1h', p_width '1 hour'
--   p_source 'telemetry.rollup_1h' -> p_target 'telemetry.rollup_1d', p_width '1 day', p_tz 'Asia/Dubai'
-- SECURITY INVOKER (the caller needs INSERT on the target; only nexus_worker has it). The tables are
-- regclass parameters checked against the two allowed pairs, so the dynamic SQL below can only touch them.
CREATE OR REPLACE FUNCTION telemetry.refresh_rollup_combine(
  p_source regclass, p_target regclass, p_width interval,
  p_from timestamptz, p_to timestamptz, p_tz text DEFAULT 'UTC'
) RETURNS int LANGUAGE plpgsql AS $$
DECLARE v_rows int;
BEGIN
  IF (p_source, p_target) NOT IN (
       ('telemetry.rollup_5m'::regclass, 'telemetry.rollup_1h'::regclass),
       ('telemetry.rollup_1h'::regclass, 'telemetry.rollup_1d'::regclass)) THEN
    RAISE EXCEPTION 'refresh_rollup_combine: only rollup_5m to rollup_1h and rollup_1h to rollup_1d are allowed';
  END IF;
  EXECUTE format($f$
    INSERT INTO %s AS r (asset_id, bucket, stats, packets)
    SELECT asset_id, bucket,
           jsonb_object_agg(k, jsonb_build_object('min', mn, 'max', mx, 'avg', av, 'last', lst, 'n', n)),
           sum_packets
    FROM (
      SELECT x.asset_id, x.bucket2 AS bucket, e.key AS k,
             min((e.value->>'min')::numeric) AS mn,
             max((e.value->>'max')::numeric) AS mx,
             round(sum((e.value->>'avg')::numeric * (e.value->>'n')::numeric)
                   / NULLIF(sum((e.value->>'n')::numeric), 0), 6) AS av,
             (array_agg((e.value->>'last')::numeric ORDER BY x.bucket DESC))[1] AS lst,
             sum((e.value->>'n')::numeric)::bigint AS n,
             max(x.sum_packets) AS sum_packets
      FROM (
        SELECT s.*,
               (date_bin($1, s.bucket AT TIME ZONE $4, timestamp '2000-01-01') AT TIME ZONE $4) AS bucket2,
               sum(s.packets) OVER (PARTITION BY s.asset_id,
                    date_bin($1, s.bucket AT TIME ZONE $4, timestamp '2000-01-01')) AS sum_packets
        FROM %s s
        WHERE s.bucket >= $2 AND s.bucket < $3
      ) x
      CROSS JOIN LATERAL jsonb_each(x.stats) e
      GROUP BY 1, 2, 3
    ) t
    GROUP BY asset_id, bucket, sum_packets
    ON CONFLICT (asset_id, bucket) DO UPDATE
      SET stats = EXCLUDED.stats, packets = EXCLUDED.packets, refreshed_at = now()
  $f$, p_target, p_source)
  USING p_width, p_from, p_to, p_tz;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END $$;

-- =====================================================================
-- EVENTS (alerts / notifications exactly as the source raises them)
-- =====================================================================
CREATE TABLE events.event (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  occurred_at    timestamptz NOT NULL,
  source_system  text NOT NULL,
  external_id    text NOT NULL,
  project_id     uuid,
  asset_id       uuid,
  building_id    uuid,                         -- BIM-ready (nullable)
  level_id       uuid,                         -- BIM-ready (nullable)
  zone_id        uuid,                         -- BIM-ready (nullable)
  category       text,                         -- as reported (alarm, fault, info, maintenance…)
  severity       text,                         -- as reported
  title          text NOT NULL,
  message        text,
  source_state   text,                         -- as reported (active, acknowledged, cleared…)
  cleared_at     timestamptz,
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, occurred_at),
  UNIQUE (source_system, external_id, occurred_at)
) PARTITION BY RANGE (occurred_at);
CREATE INDEX event_project_time_idx ON events.event (project_id, occurred_at DESC);
CREATE INDEX event_asset_time_idx   ON events.event (asset_id, occurred_at DESC);
CREATE INDEX event_title_trgm_idx   ON events.event USING gin (title gin_trgm_ops);  -- notification search

-- Per-user read state for the bell (docs/06 section 3, item 11).
-- "Mark all read" moves a read_marker; event_read holds only events read one by one AFTER the marker.
-- Unread = events in scope with occurred_at > the user's marker (global or per project, whichever is
-- later) and no event_read row. event_read is partitioned like events.event and dropped with it.
CREATE TABLE events.read_marker (
  user_id      uuid NOT NULL REFERENCES access.app_user(id) ON DELETE CASCADE,
  project_id   uuid REFERENCES core.project(id) ON DELETE CASCADE,  -- NULL = every project in the user's scope
  read_before  timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX read_marker_user_all_uq     ON events.read_marker (user_id) WHERE project_id IS NULL;
CREATE UNIQUE INDEX read_marker_user_project_uq ON events.read_marker (user_id, project_id) WHERE project_id IS NOT NULL;

CREATE TABLE events.event_read (
  user_id      uuid NOT NULL REFERENCES access.app_user(id) ON DELETE CASCADE,
  event_id     uuid NOT NULL,
  occurred_at  timestamptz NOT NULL,
  read_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id, occurred_at)
) PARTITION BY RANGE (occurred_at);

-- =====================================================================
-- INTEGRATION
-- =====================================================================
CREATE TABLE integration.sync_run (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_system  text NOT NULL,
  job            text NOT NULL,                -- catalogue_sync, live_poll, events_sync, backfill, rollups, maintenance
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  status         text NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','partial','failed','skipped')),
  items_read     int NOT NULL DEFAULT 0,
  items_written  int NOT NULL DEFAULT 0,
  api_calls      int NOT NULL DEFAULT 0,
  credits_used   bigint NOT NULL DEFAULT 0,
  lag_seconds    int,                          -- now() - newest packet time
  error          jsonb,                        -- failures only
  details        jsonb                         -- typed summary per job (packages/shared SyncRunDetails); added by the catalogue_sync_details migration
);
CREATE INDEX sync_run_job_time_idx ON integration.sync_run (source_system, job, started_at DESC);

-- Every call to an external API (rate/credit tracking, health page). Daily partitions, 30-day retention.
CREATE TABLE integration.api_call (
  at             timestamptz NOT NULL DEFAULT now(),
  source_system  text NOT NULL,
  endpoint       text NOT NULL,                -- logical name: assets.list, telemetry.bulk, asset.latest
  http_status    int,
  duration_ms    int,
  credits        int,
  rate_limit     jsonb,                        -- X-RateLimit-* headers as received
  correlation_id text,
  error_code     text
) PARTITION BY RANGE (at);
CREATE INDEX api_call_at_idx ON integration.api_call (source_system, at DESC);

-- New source sites/assets that could not be linked automatically
CREATE TABLE integration.link_todo (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system         text NOT NULL,
  entity_type           text NOT NULL CHECK (entity_type IN ('site','asset','asset_type','status_value')),
  external_id           text NOT NULL,
  payload               jsonb NOT NULL,
  suggested_project_id  uuid REFERENCES core.project(id),
  status                text NOT NULL DEFAULT 'open' CHECK (status IN ('open','linked','ignored')),
  resolved_by           uuid REFERENCES access.app_user(id),
  resolved_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_system, entity_type, external_id)
);

-- Cursors / watermarks per job (e.g. last event time read)
CREATE TABLE integration.cursor (
  source_system  text NOT NULL,
  job            text NOT NULL,
  value          jsonb NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_system, job)
);

-- =====================================================================
-- AUDIT
-- =====================================================================
CREATE TABLE audit.log (
  id              bigint GENERATED ALWAYS AS IDENTITY,
  at              timestamptz NOT NULL DEFAULT now(),
  user_id         uuid,
  action          text NOT NULL,      -- auth.sign_in, admin.group_role.create, explorer.export_csv, …
  target_type     text,
  target_id       text,
  details         jsonb,
  ip              inet,
  user_agent      text,
  correlation_id  text,
  PRIMARY KEY (id, at)
) PARTITION BY RANGE (at);
CREATE INDEX audit_user_time_idx ON audit.log (user_id, at DESC);

-- =====================================================================
-- READ VIEWS (used by API modules that own no tables: equipment, energy, portfolio tiles)
-- Equipment views include kind = 'physical' only (docs/adr/0009).
-- =====================================================================
CREATE OR REPLACE VIEW core.v_asset_live AS
SELECT a.id               AS asset_id,
       a.project_id,
       a.name,
       a.external_id,
       t.code             AS asset_type,
       t.category,
       t.icon,
       a.make, a.model, a.serial_no, a.ownership, a.asset_info,
       s.source_value     AS status_source_value,
       coalesce(m.display_status, 'unknown') AS status_display,
       s.since            AS status_since,
       lp.ts              AS last_packet_at,
       lp.values          AS latest_values,
       l.latitude, l.longitude, l.observed_at AS location_at
FROM core.asset a
LEFT JOIN core.asset_type t                 ON t.id = a.asset_type_id
LEFT JOIN telemetry.asset_status_current s  ON s.asset_id = a.id
LEFT JOIN telemetry.status_map m            ON m.source_system = a.source_system AND m.source_value = s.source_value
LEFT JOIN telemetry.latest_packet lp        ON lp.asset_id = a.id
LEFT JOIN telemetry.asset_location_current l ON l.asset_id = a.id
WHERE a.retired_at IS NULL
  AND a.kind = 'physical'
  AND a.project_id IS NOT NULL;   -- unlinked assets are not shown anywhere (admin linking reads core.asset)

-- Info box 2 / equipment counts per project, type and display status (equipment only, via v_asset_live)
CREATE OR REPLACE VIEW core.v_project_asset_counts AS
SELECT project_id, asset_type, category, status_display, count(*) AS assets
FROM core.v_asset_live
WHERE project_id IS NOT NULL
GROUP BY project_id, asset_type, category, status_display;

-- Site-level values as the source reports them (kind = 'site_metric'): energy site totals (R-25) now,
-- manpower / weather later. Never shown as equipment, never on the map.
CREATE OR REPLACE VIEW core.v_site_metric_live AS
SELECT a.id               AS asset_id,
       a.project_id,
       a.name,
       a.external_id,
       a.source_system,
       a.source_type_name,
       lp.ts              AS last_packet_at,
       lp.values          AS latest_values
FROM core.asset a
LEFT JOIN telemetry.latest_packet lp ON lp.asset_id = a.id
WHERE a.retired_at IS NULL
  AND a.kind = 'site_metric'
  AND a.project_id IS NOT NULL;

-- =====================================================================
-- SEED DATA (reference values; environment-specific seeds live in db/seeds)
-- =====================================================================
INSERT INTO core.source_system (code, name) VALUES ('datoms', 'DATOMS IoT Platform');

INSERT INTO core.setting (key, value, description) VALUES
  ('poll.interval_seconds',       '60',  'Default live poll interval. Budget tracker may slow it, never speed it beyond limits. Per-type override: asset_type.poll_interval_seconds (ADR 0006).'),
  ('poll.subset_external_ids',    'null','null = poll the full fleet (prod). A JSON array of DATOMS ids = poll only these in id mode (non-prod; ADR 0005). Set per environment in db/seeds.'),
  ('budget.max_share',            '1.0', 'Share of every DATOMS credit/request cap this environment may use (ADR 0005). Prod 1.0; dev seed sets a small share.'),
  ('rollup.close_grace_intervals','2',   'A 5-minute bucket is rolled up once, this many poll intervals after it ends (ADR 0007).'),
  ('telemetry.expected_packets_per_minute','1','Used only to show data coverage on charts (packets / expected). INTERIM from the DATOMS PDF ("typically once per minute") until Q12.'),
  ('catalogue.interval_minutes',  '60',  'Catalogue sync interval'),
  ('catalogue.retire_after_misses','2',  'Retire an asset only after this many consecutive COMPLETE catalogue walks without it'),
  ('catalogue.retire_max_fraction','0.05','If one sync would retire more than this share of active assets, retire nothing and alert'),
  ('retention.packet_days',       '90',  'Raw packets kept (days). Stays 90 until open question Q15 (archive) is answered.'),
  ('retention.rollup_5m_days',    '60',  '5-minute rollups kept (days). Decided 2026-10-08 (architecture review 1); older ranges use hourly rollups.'),
  ('retention.rollup_1h_days',    '1830','Hourly rollups kept (days)'),
  ('retention.api_call_days',     '30',  'External API call log kept (days)'),
  ('retention.audit_days',        '730', 'Audit log kept (days)'),
  ('audit.sign_in_gap_minutes',   '60',  'A sign-in is audited (auth.sign_in) when the access cache misses and the user previous last_seen_at is older than this many minutes (docs/08 section 2 step 6). TODO: switch to the Entra sid claim if S0-04 confirms tokens carry it (Q38).'),
  ('retention.event_days',        '730', 'Events kept (days)'),
  ('retention.status_history_days','730','Status change history kept (days)'),
  ('retention.location_history_days','400','Location history kept (days)'),
  ('display.stale_after_seconds', '300', 'INTERIM stale rule until DATOMS states its offline rule (open question Q8)'),
  ('display.timezone',            '"Asia/Dubai"', 'Display timezone and local-day boundary'),
  ('archive.enabled',             'false', 'Export partitions to Blob (Parquet) before dropping. Deferred (ADR 0008) until Q15 is answered.');

INSERT INTO core.feature_flag (key, enabled, description) VALUES
  ('project.weather',     false, 'Weather box (phase 2)'),
  ('project.manpower',    false, 'Info box 1 manpower / HSE (phase 2)'),
  ('project.materials',   false, 'Info box 4 tracked materials (phase 2)'),
  ('project.gallery',     false, 'Gallery, drone library, CCTV overlay (phase 2)'),
  ('project.bim',         false, 'BIM digital twin (phase 3)'),
  ('explorer.csv_export', true,  'CSV export in data explorer');

INSERT INTO core.asset_type (code, display_name, category, icon) VALUES
  ('tower_crane',      'Tower crane',      'equipment', 'tower-crane'),
  ('hoist',            'Hoist',            'equipment', 'hoist'),
  ('diesel_generator', 'Diesel generator', 'energy',    'generator'),
  ('fuel_tank',        'Fuel tank',        'energy',    'fuel-tank'),
  ('solar',            'Solar',            'energy',    'solar'),
  ('mains',            'Mains',            'energy',    'mains'),
  ('forklift',         'Forklift',         'vehicle',   'forklift'),
  ('boom_lift',        'Boom lift',        'vehicle',   'boom-lift'),
  ('bus',              'Bus',              'vehicle',   'bus'),
  ('truck',            'Truck',            'vehicle',   'truck'),
  ('generic',          'Equipment',        'other',     'generic');

INSERT INTO access.role (code, name, description, all_projects) VALUES
  ('admin',           'Administrator',   'Innovo Labs: full access incl. admin', true),
  ('leadership',      'Leadership',      'All projects, read',                    true),
  ('project_manager', 'Project manager', 'Assigned projects, read + explorer',    false),
  ('site_user',       'Site user',       'Assigned projects, read',               false),
  ('viewer',          'Viewer',          'Assigned projects, limited read',       false);

INSERT INTO access.permission (key, description) VALUES
  ('portfolio.read',        'See the portfolio map and project list'),
  ('project.read',          'See a project page'),
  ('asset.read',            'See assets and live values'),
  ('telemetry.history',     'See trend charts and history'),
  ('events.read',           'See alerts and notifications'),
  ('explorer.use',          'Use the data explorer'),
  ('explorer.export',       'Export CSV from the explorer'),
  ('admin.users.manage',    'Manage group-role mappings and project access'),
  ('admin.projects.manage', 'Create projects and edit admin-held project fields; assign assets'),
  ('admin.integrations',    'See integration health and resolve linking to-do'),
  ('admin.settings',        'Change settings and feature flags'),
  ('audit.read',            'Read the audit log'),
  -- reserved for later phases (no endpoints yet)
  ('cctv.view',             'View live CCTV (phase 2)'),
  ('media.read',            'View gallery and drone library (phase 2)'),
  ('bim.view',              'View BIM models (phase 3)');

INSERT INTO access.role_permission (role_code, permission_key)
SELECT 'admin', key FROM access.permission;
INSERT INTO access.role_permission (role_code, permission_key) VALUES
  ('leadership','portfolio.read'),('leadership','project.read'),('leadership','asset.read'),
  ('leadership','telemetry.history'),('leadership','events.read'),('leadership','explorer.use'),('leadership','explorer.export'),
  ('project_manager','portfolio.read'),('project_manager','project.read'),('project_manager','asset.read'),
  ('project_manager','telemetry.history'),('project_manager','events.read'),('project_manager','explorer.use'),('project_manager','explorer.export'),
  ('site_user','portfolio.read'),('site_user','project.read'),('site_user','asset.read'),
  ('site_user','telemetry.history'),('site_user','events.read'),
  ('viewer','portfolio.read'),('viewer','project.read'),('viewer','asset.read');

-- =====================================================================
-- INITIAL PARTITIONS (the worker maintenance job keeps these rolling daily)
-- =====================================================================
SELECT core.create_range_partitions('telemetry.packet',                 'day',   current_date - 1, 9);
SELECT core.create_range_partitions('telemetry.rollup_5m',              'month', current_date, 3);
SELECT core.create_range_partitions('telemetry.rollup_1h',              'month', current_date, 3);
SELECT core.create_range_partitions('telemetry.asset_status_history',   'month', current_date, 3);
SELECT core.create_range_partitions('telemetry.asset_location_history', 'month', current_date, 3);
SELECT core.create_range_partitions('events.event',                     'month', current_date, 3);
SELECT core.create_range_partitions('events.event_read',                'month', current_date, 3);
SELECT core.create_range_partitions('integration.api_call',             'day',   current_date - 1, 9);
SELECT core.create_range_partitions('audit.log',                        'month', current_date, 3);

-- =====================================================================
-- FUTURE TABLES (do NOT create in phase 1 — shown so phase 1 leaves room)
-- =====================================================================
-- materials.material_package (id, project_id, serial_no, description, supplier, lpo_number,
--     order_date, required_on_site_date, source_state, last_update_at, source_system, external_id)
-- manpower.daily_count (project_id, day, direct, subcontractor, manhours, safe_manhours, ltifr, source_system)
-- media.item (id, project_id, kind photo|video|drone|cctv, blob_path, captured_at, uploaded_by)
-- bim.model (id, project_id, building_id, provider arcgis_i3s|aps|ifc, ref, version, uploaded_at)
-- bim.element_link (model_id, element_guid, zone_id, asset_id)
