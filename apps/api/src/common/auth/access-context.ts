import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PermissionKey, RoleCode } from '@nexus/shared';

/** docs/08 section 2, step 3. */
export interface AccessContext {
  userId: string;
  roles: RoleCode[];
  permissions: Set<PermissionKey>;
  /** Any role has all_projects. */
  allProjects: boolean;
  /** Empty when allProjects is true. */
  projectIds: Set<string>;
}

export function hasPermission(ctx: AccessContext, key: PermissionKey): boolean {
  return ctx.permissions.has(key);
}

/** Project scope check. Callers answer 404 (never 403) when this is false (CLAUDE.md rule 6). */
export function canAccessProject(ctx: AccessContext, projectId: string): boolean {
  return ctx.allProjects || ctx.projectIds.has(projectId);
}

export interface SignedInIdentity {
  /** Entra object id of the user. */
  oid: string;
  displayName?: string;
  email?: string;
  /** From the token `groups` claim (groups assigned to the application, ADR 0008). */
  groupIds: string[];
}

/**
 * Where users, roles and project scope come from. S1-01 supplies the Postgres implementation
 * (access.app_user, access.user_roles(), access.user_project_ids()); until then the in-memory
 * one is bound. Implementations must not cache: AccessContextService does.
 */
export interface AccessDirectory {
  /** Upsert access.app_user by oid (name, email, last_seen_at). */
  upsertUser(identity: SignedInIdentity): Promise<{ userId: string; isActive: boolean }>;
  /** Roles, permissions and project scope for a user and the group ids of the token. */
  loadAccess(userId: string, groupIds: string[]): Promise<AccessContext>;
}

export const ACCESS_DIRECTORY = Symbol('ACCESS_DIRECTORY');
export const CLOCK = Symbol('CLOCK');

export class InactiveUserError extends Error {}

export const ACCESS_CONTEXT_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  userId: string;
  context: AccessContext;
  expiresAt: number;
}

/** Builds the AccessContext and caches it for 5 minutes per user + group hash (docs/08). */
@Injectable()
export class AccessContextService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @Inject(ACCESS_DIRECTORY) private readonly directory: AccessDirectory,
    @Inject(CLOCK) private readonly now: () => number,
  ) {}

  /** @throws InactiveUserError when the user is deactivated (never cached). */
  async resolve(identity: SignedInIdentity): Promise<AccessContext> {
    const key = `${identity.oid.toLowerCase()}:${groupHash(identity.groupIds)}`;
    const now = this.now();
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > now) return hit.context;
    this.evictExpired(now);

    const { userId, isActive } = await this.directory.upsertUser(identity);
    if (!isActive) {
      this.cache.delete(key);
      throw new InactiveUserError();
    }
    const context = await this.directory.loadAccess(userId, identity.groupIds);
    this.cache.set(key, { userId, context, expiresAt: now + ACCESS_CONTEXT_TTL_MS });
    return context;
  }

  /** Call after an admin change that affects one user (role, project access, deactivation). */
  invalidateUser(userId: string): void {
    for (const [key, entry] of this.cache) if (entry.userId === userId) this.cache.delete(key);
  }

  /** Call after a change that affects many users (group-role mapping). */
  invalidateAll(): void {
    this.cache.clear();
  }

  private evictExpired(now: number): void {
    for (const [key, entry] of this.cache) if (entry.expiresAt <= now) this.cache.delete(key);
  }
}

function groupHash(groupIds: string[]): string {
  const sorted = [...new Set(groupIds.map((g) => g.toLowerCase()))].sort();
  return createHash('sha256').update(sorted.join(',')).digest('hex').slice(0, 16);
}
