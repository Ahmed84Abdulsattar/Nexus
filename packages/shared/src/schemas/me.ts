import { z } from 'zod';
import { PERMISSION_KEYS, ROLE_CODES } from '../permissions.js';

/**
 * GET /v1/me (docs/10, docs/08 section 5, @AnySignedIn): the signed-in user, from the AccessContext.
 * The UI hides things by `permissions`; the API is the real check on every request.
 */
export const meResponseSchema = z.object({
  id: z.uuid(),
  /** As stored in access.app_user; null when the token never carried one. */
  name: z.string().nullable(),
  email: z.string().nullable(),
  roles: z.array(z.enum(ROLE_CODES)),
  permissions: z.array(z.enum(PERMISSION_KEYS)),
  projectScope: z.object({
    /** True when a role has all_projects; `projectIds` is then empty. */
    all: z.boolean(),
    projectIds: z.array(z.uuid()),
  }),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
