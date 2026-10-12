/**
 * Permission keys: the single source of truth for the API decorators and the frontend <Can>
 * component (docs/08 section 3). A migration adds any new key to access.permission.
 */
export const PERMISSION_KEYS = [
  'portfolio.read',
  'project.read',
  'asset.read',
  'telemetry.history',
  'events.read',
  'explorer.use',
  'explorer.export',
  'admin.users.manage',
  'admin.projects.manage',
  'admin.integrations',
  'admin.settings',
  'audit.read',
  // Reserved for later phases (seeded, no endpoints yet).
  'cctv.view',
  'media.read',
  'bim.view',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSION_KEYS as readonly string[]).includes(value);
}

/** Role codes seeded in db/schema.sql (open question Q17 may change the list). */
export const ROLE_CODES = [
  'admin',
  'leadership',
  'project_manager',
  'site_user',
  'viewer',
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];
