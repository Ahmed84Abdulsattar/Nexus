import { z } from 'zod';

/**
 * Local development sign-in (docs/08 "Local development sign-in"): the seeded demo users that
 * POST /v1/dev/token can sign a token for. The route exists only when AUTH_MODE=dev and
 * APP_ENV=local; it is not part of the OpenAPI contract. The group ids are the fake demo GUIDs of
 * db/seeds/dev-roles.sql. Each user's `oid` is fixed so the same person comes back after a restart.
 */
export const DEV_USERS = [
  {
    key: 'admin',
    label: 'Admin',
    name: 'Demo Admin',
    email: 'demo.admin@nexus.local',
    oid: '00000000-0000-4000-8000-00000000d001',
    groupId: '00000000-0000-4000-8000-00000000a001',
  },
  {
    key: 'leadership',
    label: 'Leadership',
    name: 'Demo Leadership',
    email: 'demo.leadership@nexus.local',
    oid: '00000000-0000-4000-8000-00000000d002',
    groupId: '00000000-0000-4000-8000-00000000a002',
  },
  {
    key: 'project_manager',
    label: 'Project manager',
    name: 'Demo Project Manager',
    email: 'demo.project.manager@nexus.local',
    oid: '00000000-0000-4000-8000-00000000d003',
    groupId: '00000000-0000-4000-8000-00000000a003',
  },
  {
    key: 'site_user',
    label: 'Site user',
    name: 'Demo Site User',
    email: 'demo.site.user@nexus.local',
    oid: '00000000-0000-4000-8000-00000000d004',
    groupId: '00000000-0000-4000-8000-00000000a004',
  },
  {
    key: 'viewer',
    label: 'Viewer',
    name: 'Demo Viewer',
    email: 'demo.viewer@nexus.local',
    oid: '00000000-0000-4000-8000-00000000d005',
    groupId: '00000000-0000-4000-8000-00000000a005',
  },
] as const;

export const DEV_USER_KEYS = [
  'admin',
  'leadership',
  'project_manager',
  'site_user',
  'viewer',
] as const;

/** `user` is a plain string on purpose: the handler answers an unknown name with 400, not 422. */
export const devTokenRequestSchema = z.object({ user: z.string().min(1).max(64) });
export type DevTokenRequest = z.infer<typeof devTokenRequestSchema>;

export const devTokenResponseSchema = z.object({
  tokenType: z.literal('Bearer'),
  accessToken: z.string(),
  /** Seconds. */
  expiresIn: z.number().int().positive(),
  user: z.object({ key: z.enum(DEV_USER_KEYS), name: z.string() }),
});
export type DevTokenResponse = z.infer<typeof devTokenResponseSchema>;
