import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PermissionKey, RoleCode } from '@nexus/shared';

/** docs/08 section 2, step 3. */
export interface AccessContext {
  readonly userId: string;
  readonly roles: readonly RoleCode[];
  readonly permissions: ReadonlySet<PermissionKey>;
  /** Any role has all_projects. */
  readonly allProjects: boolean;
  /** Lower-case ids. Empty when allProjects is true. */
  readonly projectIds: ReadonlySet<string>;
}

/** A Set that throws on change: Object.freeze does not stop Set.add. */
class ImmutableSet<T> extends Set<T> {
  override add(): never {
    throw new TypeError('AccessContext is read-only');
  }
  override delete(): never {
    throw new TypeError('AccessContext is read-only');
  }
  override clear(): never {
    throw new TypeError('AccessContext is read-only');
  }
}

function immutableSet<T>(values: Iterable<T>): ReadonlySet<T> {
  // Fill through Set.prototype.add: the overridden add() is for callers.
  const set = new ImmutableSet<T>();
  for (const v of values) Set.prototype.add.call(set, v);
  return set;
}

/** A deep-frozen copy; cached contexts are shared between requests and must not change. */
export function freezeAccessContext(ctx: AccessContext): AccessContext {
  return Object.freeze({
    userId: ctx.userId,
    roles: Object.freeze([...ctx.roles]),
    permissions: immutableSet(ctx.permissions),
    allProjects: ctx.allProjects,
    projectIds: immutableSet([...ctx.projectIds].map((id) => id.toLowerCase())),
  });
}

export function hasPermission(ctx: AccessContext, key: PermissionKey): boolean {
  return ctx.permissions.has(key);
}

/** Project scope check. Callers answer 404 (never 403) when this is false (CLAUDE.md rule 6). */
export function canAccessProject(ctx: AccessContext, projectId: string): boolean {
  // The single place where project ids are compared: case-insensitive.
  return ctx.allProjects || ctx.projectIds.has(projectId.toLowerCase());
}

/** What the sign-in audit row records about the request (docs/08 section 2, step 6). */
export interface RequestInfo {
  ip?: string;
  userAgent?: string;
  correlationId?: string;
}

export interface SignedInIdentity {
  /** Entra object id of the user. */
  oid: string;
  /** Entra tenant id (`tid`), already checked against the configured tenant. */
  tenantId: string;
  displayName?: string;
  email?: string;
  /** From the token `groups` claim (groups assigned to the application, ADR 0008). */
  groupIds: string[];
  request?: RequestInfo;
}

/**
 * Where users, roles and project scope come from: Postgres in the API
 * (PostgresAccessDirectory: access.app_user, access.user_roles(), access.user_project_ids()), an
 * in-memory one in tests. Implementations must not cache: AccessContextService does.
 */
export interface AccessDirectory {
  /**
   * Upsert access.app_user by oid (name, email, last_seen_at). When the user is active and has been
   * idle for the setting audit.sign_in_gap_minutes (or is new), also writes the `auth.sign_in` audit row.
   */
  upsertUser(identity: SignedInIdentity): Promise<{ userId: string; isActive: boolean }>;
  /** Roles, permissions and project scope for a user and the group ids of the token. */
  loadAccess(userId: string, groupIds: string[]): Promise<AccessContext>;
  /** Current is_active flag. Checked on every cache hit (a deactivated user must not wait for the TTL). */
  isUserActive(userId: string): Promise<boolean>;
}

/** Used when the setting core.setting audit.sign_in_gap_minutes is missing or unreadable. */
export const DEFAULT_SIGN_IN_GAP_MINUTES = 60;

export const ACCESS_DIRECTORY = Symbol('ACCESS_DIRECTORY');
export const CLOCK = Symbol('CLOCK');

export class InactiveUserError extends Error {}

export const ACCESS_CONTEXT_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  userId: string;
  context: AccessContext;
  expiresAt: number;
}

/**
 * Builds the AccessContext and caches it for 5 minutes per user + group hash (docs/08).
 *
 * The cache is kept correct across API instances (S1-02 review L3, fixed here):
 *  - Changes are announced by the database (NOTIFY nexus_access, see AccessChangeListener), which
 *    calls invalidateUser / invalidateAll on every instance.
 *  - A cache hit still checks is_active in the database (one primary-key lookup), so a deactivated
 *    user is refused at once even if a notification is late.
 *  - A load that started before an invalidation is never cached: every invalidation bumps `epoch`,
 *    and a load stores its result only if the epoch is the same as when it started.
 *  - While the notification channel is down the cache is not used at all (fail safe: every request
 *    loads from the database) until it is back, and it comes back empty.
 */
@Injectable()
export class AccessContextService {
  private readonly cache = new Map<string, CacheEntry>();
  /** Bumped by every invalidation. */
  private epoch = 0;
  /** Fails closed: the cache is used only after the change listener has proved it is hearing the database. */
  private channelUp = false;

  constructor(
    @Inject(ACCESS_DIRECTORY) private readonly directory: AccessDirectory,
    @Inject(CLOCK) private readonly now: () => number,
  ) {}

  /** @throws InactiveUserError when the user is deactivated (never cached). */
  async resolve(identity: SignedInIdentity): Promise<AccessContext> {
    const key = `${identity.oid.toLowerCase()}:${groupHash(identity.groupIds)}`;
    const now = this.now();
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > now && this.channelUp) {
      if (await this.directory.isUserActive(hit.userId)) return hit.context;
      this.invalidateUser(hit.userId);
      throw new InactiveUserError();
    }
    this.evictExpired(now);

    // Read before the load starts: any invalidation after this point blocks caching this result.
    const startedAtEpoch = this.epoch;
    const { userId, isActive } = await this.directory.upsertUser(identity);
    if (!isActive) {
      this.cache.delete(key);
      throw new InactiveUserError();
    }
    const context = freezeAccessContext(await this.directory.loadAccess(userId, identity.groupIds));
    if (this.epoch === startedAtEpoch && this.channelUp) {
      this.cache.set(key, { userId, context, expiresAt: this.now() + ACCESS_CONTEXT_TTL_MS });
    }
    return context;
  }

  /** Call after a change that affects one user (role, project access, deactivation). */
  invalidateUser(userId: string): void {
    this.epoch += 1;
    for (const [key, entry] of this.cache) if (entry.userId === userId) this.cache.delete(key);
  }

  /** Call after a change that affects many users (group-role mapping), or when notifications may have been missed. */
  invalidateAll(): void {
    this.epoch += 1;
    this.cache.clear();
  }

  /**
   * Set by AccessChangeListener. Down: the cache is cleared and not used. Up again: starts empty,
   * because notifications sent while it was down were missed.
   */
  setChangeChannelUp(up: boolean): void {
    this.channelUp = up;
    this.invalidateAll();
  }

  private evictExpired(now: number): void {
    for (const [key, entry] of this.cache) if (entry.expiresAt <= now) this.cache.delete(key);
  }
}

function groupHash(groupIds: string[]): string {
  const sorted = [...new Set(groupIds.map((g) => g.toLowerCase()))].sort();
  return createHash('sha256').update(sorted.join(',')).digest('hex').slice(0, 16);
}
