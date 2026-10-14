import { isIP } from 'node:net';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Database } from '@nexus/db';
import { isPermissionKey, ROLE_CODES, type PermissionKey, type RoleCode } from '@nexus/shared';
import { sql } from 'kysely';
import { z } from 'zod';
import { DB } from '../db/database.module.js';
import {
  type AccessContext,
  type AccessDirectory,
  SIGN_IN_IDLE_MINUTES,
  type SignedInIdentity,
} from './access-context.js';

const uuid = z.uuid();

/**
 * The access schema in Postgres (docs/06, docs/08 section 2). Connects as the nexus_api role, which
 * may write access.app_user and audit.log but not roles or permissions.
 */
@Injectable()
export class PostgresAccessDirectory implements AccessDirectory {
  private readonly logger = new Logger(PostgresAccessDirectory.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  async upsertUser(identity: SignedInIdentity): Promise<{ userId: string; isActive: boolean }> {
    // Users are matched by oid only (never by email). A name or email that the token lacks keeps
    // its stored value. `new_session` is computed from the PREVIOUS last_seen_at, in the same statement.
    const { rows } = await sql<{ id: string; is_active: boolean; new_session: boolean }>`
      WITH previous AS (
        SELECT last_seen_at FROM access.app_user WHERE entra_oid = ${identity.oid}::uuid
      )
      INSERT INTO access.app_user (entra_oid, tenant_id, email, display_name, last_seen_at)
      VALUES (${identity.oid}::uuid, ${identity.tenantId}::uuid, ${identity.email ?? null},
              ${identity.displayName ?? null}, now())
      ON CONFLICT (entra_oid) DO UPDATE SET
        email        = COALESCE(EXCLUDED.email, access.app_user.email),
        display_name = COALESCE(EXCLUDED.display_name, access.app_user.display_name),
        last_seen_at = now()
      RETURNING id, is_active,
        coalesce((SELECT last_seen_at FROM previous) < now() - make_interval(mins => ${SIGN_IN_IDLE_MINUTES}), true)
          AS new_session`.execute(this.db);
    const row = rows[0];
    if (!row) throw new Error('access.app_user upsert returned no row');

    if (row.is_active && row.new_session) await this.auditSignIn(row.id, identity);
    return { userId: row.id, isActive: row.is_active };
  }

  async isUserActive(userId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('access.app_user')
      .select('is_active')
      .where('id', '=', userId)
      .executeTakeFirst();
    return row?.is_active === true;
  }

  async loadAccess(userId: string, groupIds: string[]): Promise<AccessContext> {
    // The token is not trusted to be well formed: only UUIDs reach the uuid[] cast.
    const groups = [
      ...new Set(groupIds.filter((g) => uuid.safeParse(g).success).map((g) => g.toLowerCase())),
    ];

    // One statement = one snapshot, so roles, permissions and projects always agree with each other.
    const { rows } = await sql<{
      roles: string[];
      permissions: string[];
      all_projects: boolean;
      project_ids: string[];
    }>`
      WITH my_roles AS (
        SELECT r AS code FROM access.user_roles(${userId}::uuid, ${groups}::uuid[]) AS r
      ), flags AS (
        SELECT coalesce(bool_or(role.all_projects), false) AS all_projects
        FROM access.role role JOIN my_roles ON my_roles.code = role.code
      )
      SELECT
        coalesce((SELECT array_agg(code ORDER BY code) FROM my_roles), '{}') AS roles,
        coalesce((SELECT array_agg(DISTINCT rp.permission_key ORDER BY rp.permission_key)
                  FROM access.role_permission rp JOIN my_roles ON my_roles.code = rp.role_code), '{}') AS permissions,
        (SELECT all_projects FROM flags) AS all_projects,
        CASE WHEN (SELECT all_projects FROM flags) THEN '{}'::uuid[]
             ELSE coalesce(ARRAY(SELECT access.user_project_ids(${userId}::uuid, ${groups}::uuid[])), '{}') END AS project_ids`.execute(
      this.db,
    );
    const row = rows[0];
    if (!row) throw new Error('access query returned no row');

    return {
      userId,
      roles: row.roles.filter((r): r is RoleCode => (ROLE_CODES as readonly string[]).includes(r)),
      permissions: new Set<PermissionKey>(row.permissions.filter(isPermissionKey)),
      allProjects: row.all_projects,
      projectIds: new Set(row.project_ids.map((id) => id.toLowerCase())),
    };
  }

  /**
   * The sign-in audit row (docs/08 section 2, step 6; Q29 c). Written on the first request after
   * SIGN_IN_IDLE_MINUTES of silence, because a bearer-token API has no session of its own.
   * A failed audit write is logged loudly but does not lock everybody out (a missing partition is an
   * operations problem for the maintenance job, not a reason to refuse users).
   */
  private async auditSignIn(userId: string, identity: SignedInIdentity): Promise<void> {
    const req = identity.request;
    try {
      await this.db
        .insertInto('audit.log')
        .values({
          user_id: userId,
          action: 'auth.sign_in',
          target_type: 'app_user',
          target_id: userId,
          details: { groupCount: identity.groupIds.length },
          ip: req?.ip !== undefined && isIP(req.ip) !== 0 ? req.ip : null,
          user_agent: req?.userAgent?.slice(0, 512) ?? null,
          correlation_id: req?.correlationId ?? null,
        })
        .execute();
    } catch (error) {
      this.logger.error(
        `could not write the sign-in audit row: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
