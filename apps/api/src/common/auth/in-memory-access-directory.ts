import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PERMISSION_KEYS, type PermissionKey, type RoleCode } from '@nexus/shared';
import type { AccessContext, AccessDirectory, SignedInIdentity } from './access-context.js';

/** Mirrors the seed in db/schema.sql (docs/08 section 3). Postgres replaces this in S1-01. */
const ROLE_PERMISSIONS: Record<RoleCode, readonly PermissionKey[]> = {
  admin: PERMISSION_KEYS,
  leadership: [
    'portfolio.read',
    'project.read',
    'asset.read',
    'telemetry.history',
    'events.read',
    'explorer.use',
    'explorer.export',
  ],
  project_manager: [
    'portfolio.read',
    'project.read',
    'asset.read',
    'telemetry.history',
    'events.read',
    'explorer.use',
    'explorer.export',
  ],
  site_user: ['portfolio.read', 'project.read', 'asset.read', 'telemetry.history', 'events.read'],
  viewer: ['portfolio.read', 'project.read', 'asset.read'],
};

const ALL_PROJECT_ROLES: ReadonlySet<RoleCode> = new Set<RoleCode>(['admin', 'leadership']);

interface UserRow {
  id: string;
  isActive: boolean;
}

/**
 * In-memory stand-in for the access schema. Nobody has any role until one is assigned, so with
 * this bound the API denies everything that needs a permission. Tests seed it through the
 * methods below.
 */
@Injectable()
export class InMemoryAccessDirectory implements AccessDirectory {
  private readonly users = new Map<string, UserRow>(); // by oid
  private readonly groupRoles = new Map<string, Set<RoleCode>>(); // by group id
  private readonly userRoles = new Map<string, Set<RoleCode>>(); // by user id
  private readonly userProjects = new Map<string, Set<string>>(); // by user id
  private readonly groupProjects = new Map<string, Set<string>>(); // by group id

  upsertUser(identity: SignedInIdentity): Promise<{ userId: string; isActive: boolean }> {
    const row = this.ensureUser(identity.oid);
    return Promise.resolve({ userId: row.id, isActive: row.isActive });
  }

  loadAccess(userId: string, groupIds: string[]): Promise<AccessContext> {
    const groups = groupIds.map((g) => g.toLowerCase());
    const roles = new Set<RoleCode>(this.userRoles.get(userId));
    const projectIds = new Set<string>(this.userProjects.get(userId));
    for (const g of groups) {
      for (const r of this.groupRoles.get(g) ?? []) roles.add(r);
      for (const p of this.groupProjects.get(g) ?? []) projectIds.add(p);
    }
    const permissions = new Set<PermissionKey>();
    for (const r of roles) for (const k of ROLE_PERMISSIONS[r]) permissions.add(k);
    const allProjects = [...roles].some((r) => ALL_PROJECT_ROLES.has(r));
    return Promise.resolve({
      userId,
      roles: [...roles],
      permissions,
      allProjects,
      projectIds: allProjects ? new Set() : projectIds,
    });
  }

  // --- seeding helpers (tests, local experiments) ---

  /** Creates the user row if needed and returns its id. */
  ensureUser(oid: string): UserRow {
    const key = oid.toLowerCase();
    let row = this.users.get(key);
    if (!row) {
      row = { id: randomUUID(), isActive: true };
      this.users.set(key, row);
    }
    return row;
  }

  setActive(oid: string, isActive: boolean): void {
    this.ensureUser(oid).isActive = isActive;
  }

  assignGroupRole(groupId: string, role: RoleCode): void {
    add(this.groupRoles, groupId.toLowerCase(), role);
  }

  assignUserRole(oid: string, role: RoleCode): void {
    add(this.userRoles, this.ensureUser(oid).id, role);
  }

  grantProjectToUser(oid: string, projectId: string): void {
    add(this.userProjects, this.ensureUser(oid).id, projectId);
  }

  grantProjectToGroup(groupId: string, projectId: string): void {
    add(this.groupProjects, groupId.toLowerCase(), projectId);
  }
}

function add<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  const set = map.get(key) ?? new Set<V>();
  set.add(value);
  map.set(key, set);
}
