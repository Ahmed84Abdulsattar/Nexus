-- =====================================================================
-- Demo Entra group -> Nexus role mappings, for APP_ENV=local and APP_ENV=dev ONLY
-- ---------------------------------------------------------------------
-- The roles and permissions themselves are reference data in db/schema.sql (a migration changes them).
-- This file only adds access.group_role rows so a developer can sign in as each role without Admin
-- screens. The group ids are made-up demo GUIDs (obviously fake: 00000000-0000-4000-8000-00000000a00N),
-- NOT real Entra groups. Real groups are mapped by an admin in the Admin screen (R-60).
-- `pnpm db:seed` runs this file only when APP_ENV is local or dev, and the file refuses to run in
-- any other environment: the runner sets `SET nexus.app_env = '<APP_ENV>'` first.
-- No project_access rows: projects arrive from the source (the catalogue sync) or from
-- db/seeds/scale-100-sites.ts, and an admin grants them.
-- Safe to run again.
-- =====================================================================
DO $$
BEGIN
  IF current_setting('nexus.app_env', true) IS NULL
     OR current_setting('nexus.app_env', true) NOT IN ('local', 'dev') THEN
    RAISE EXCEPTION 'db/seeds/dev-roles.sql is for APP_ENV=local or dev only (nexus.app_env is %)',
      coalesce(current_setting('nexus.app_env', true), 'unset');
  END IF;
END $$;

INSERT INTO access.group_role (entra_group_id, role_code, group_name) VALUES
  ('00000000-0000-4000-8000-00000000a001', 'admin',           'Demo: Nexus-Admins'),
  ('00000000-0000-4000-8000-00000000a002', 'leadership',      'Demo: Nexus-Leadership'),
  ('00000000-0000-4000-8000-00000000a003', 'project_manager', 'Demo: Nexus-ProjectManagers'),
  ('00000000-0000-4000-8000-00000000a004', 'site_user',       'Demo: Nexus-SiteUsers'),
  ('00000000-0000-4000-8000-00000000a005', 'viewer',          'Demo: Nexus-Viewers')
ON CONFLICT (entra_group_id, role_code) DO NOTHING;
