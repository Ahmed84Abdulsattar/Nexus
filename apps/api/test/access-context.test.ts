import { describe, expect, it } from 'vitest';
import {
  ACCESS_CONTEXT_TTL_MS,
  AccessContextService,
  InactiveUserError,
} from '../src/common/auth/access-context.js';
import { InMemoryAccessDirectory } from '../src/common/auth/in-memory-access-directory.js';

const OID = 'aaaaaaaa-0000-4000-8000-000000000001';
const GROUP = 'bbbbbbbb-0000-4000-8000-00000000000a';

function setup() {
  const directory = new InMemoryAccessDirectory();
  let now = 1_000_000;
  let loads = 0;
  const counting = {
    upsertUser: directory.upsertUser.bind(directory),
    loadAccess: (...args: Parameters<typeof directory.loadAccess>) => {
      loads += 1;
      return directory.loadAccess(...args);
    },
  };
  const service = new AccessContextService(counting, () => now);
  return {
    directory,
    service,
    advance: (ms: number) => (now += ms),
    loads: () => loads,
  };
}

describe('AccessContextService', () => {
  it('builds roles, permissions and scope from the directory', async () => {
    const { directory, service } = setup();
    directory.assignGroupRole(GROUP, 'project_manager');
    directory.grantProjectToGroup(GROUP, 'p1');
    const ctx = await service.resolve({ oid: OID, groupIds: [GROUP] });
    expect(ctx.roles).toEqual(['project_manager']);
    expect(ctx.permissions.has('explorer.export')).toBe(true);
    expect(ctx.permissions.has('admin.settings')).toBe(false);
    expect(ctx.allProjects).toBe(false);
    expect([...ctx.projectIds]).toEqual(['p1']);
  });

  it('gives all-projects roles allProjects and an empty id set', async () => {
    const { directory, service } = setup();
    directory.assignUserRole(OID, 'leadership');
    directory.grantProjectToUser(OID, 'p1');
    const ctx = await service.resolve({ oid: OID, groupIds: [] });
    expect(ctx.allProjects).toBe(true);
    expect(ctx.projectIds.size).toBe(0);
  });

  it('caches for 5 minutes per user and group hash', async () => {
    const { service, advance, loads } = setup();
    await service.resolve({ oid: OID, groupIds: [GROUP] });
    await service.resolve({ oid: OID, groupIds: [GROUP] });
    expect(loads()).toBe(1);

    // same groups in another order and case: same hash
    await service.resolve({ oid: OID, groupIds: [GROUP.toUpperCase()] });
    expect(loads()).toBe(1);

    // other groups: new entry
    await service.resolve({ oid: OID, groupIds: [] });
    expect(loads()).toBe(2);

    advance(ACCESS_CONTEXT_TTL_MS - 1);
    await service.resolve({ oid: OID, groupIds: [GROUP] });
    expect(loads()).toBe(2);
    advance(2);
    await service.resolve({ oid: OID, groupIds: [GROUP] });
    expect(loads()).toBe(3);
  });

  it('shows a role change only after the cache expires or is invalidated', async () => {
    const { directory, service } = setup();
    const before = await service.resolve({ oid: OID, groupIds: [] });
    directory.assignUserRole(OID, 'admin');
    expect((await service.resolve({ oid: OID, groupIds: [] })).roles).toEqual([]);
    service.invalidateUser(before.userId);
    expect((await service.resolve({ oid: OID, groupIds: [] })).roles).toEqual(['admin']);
  });

  it('refuses inactive users and does not cache them', async () => {
    const { directory, service } = setup();
    directory.setActive(OID, false);
    await expect(service.resolve({ oid: OID, groupIds: [] })).rejects.toBeInstanceOf(
      InactiveUserError,
    );
    directory.setActive(OID, true);
    await expect(service.resolve({ oid: OID, groupIds: [] })).resolves.toBeDefined();
  });

  it('hands out a read-only, frozen context', async () => {
    const { directory, service } = setup();
    directory.assignUserRole(OID, 'viewer');
    const ctx = await service.resolve({ oid: OID, groupIds: [] });
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(Object.isFrozen(ctx.roles)).toBe(true);
    expect(() => (ctx.roles as string[]).push('admin')).toThrow(TypeError);
    expect(() => (ctx.permissions as Set<string>).add('admin.settings')).toThrow(TypeError);
    expect(() => (ctx.projectIds as Set<string>).add('p')).toThrow(TypeError);
    expect(ctx.permissions.has('asset.read')).toBe(true);
    expect(await service.resolve({ oid: OID, groupIds: [] })).toBe(ctx);
  });
});
