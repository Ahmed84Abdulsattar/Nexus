import { describe, expect, it } from 'vitest';
import {
  ACCESS_CONTEXT_TTL_MS,
  type AccessDirectory,
  AccessContextService,
  InactiveUserError,
  type SignedInIdentity,
} from '../src/common/auth/access-context.js';
import { InMemoryAccessDirectory } from '../src/common/auth/in-memory-access-directory.js';

const OID = 'aaaaaaaa-0000-4000-8000-000000000001';
const GROUP = 'bbbbbbbb-0000-4000-8000-00000000000a';
const TENANT = '11111111-2222-4333-8444-555555555555';

const who = (groupIds: string[] = [], oid = OID): SignedInIdentity => ({
  oid,
  tenantId: TENANT,
  groupIds,
});

function setup() {
  const directory = new InMemoryAccessDirectory();
  let now = 1_000_000;
  let loads = 0;
  let activeChecks = 0;
  const counting: AccessDirectory = {
    upsertUser: directory.upsertUser.bind(directory),
    isUserActive: (userId) => {
      activeChecks += 1;
      return directory.isUserActive(userId);
    },
    loadAccess: (...args) => {
      loads += 1;
      return directory.loadAccess(...args);
    },
  };
  const service = new AccessContextService(counting, () => now);
  service.setChangeChannelUp(true); // the cache is off until a listener says it is up
  return {
    directory,
    service,
    advance: (ms: number) => (now += ms),
    loads: () => loads,
    activeChecks: () => activeChecks,
  };
}

describe('AccessContextService', () => {
  it('builds roles, permissions and scope from the directory', async () => {
    const { directory, service } = setup();
    directory.assignGroupRole(GROUP, 'project_manager');
    directory.grantProjectToGroup(GROUP, 'p1');
    const ctx = await service.resolve(who([GROUP]));
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
    const ctx = await service.resolve(who());
    expect(ctx.allProjects).toBe(true);
    expect(ctx.projectIds.size).toBe(0);
  });

  it('caches for 5 minutes per user and group hash', async () => {
    const { service, advance, loads } = setup();
    await service.resolve(who([GROUP]));
    await service.resolve(who([GROUP]));
    expect(loads()).toBe(1);

    // same groups in another order and case: same hash
    await service.resolve(who([GROUP.toUpperCase()]));
    expect(loads()).toBe(1);

    // other groups: new entry
    await service.resolve(who());
    expect(loads()).toBe(2);

    advance(ACCESS_CONTEXT_TTL_MS - 1);
    await service.resolve(who([GROUP]));
    expect(loads()).toBe(2);
    advance(2);
    await service.resolve(who([GROUP]));
    expect(loads()).toBe(3);
  });

  it('shows a role change only after the cache expires or is invalidated', async () => {
    const { directory, service } = setup();
    const before = await service.resolve(who());
    directory.assignUserRole(OID, 'admin');
    expect((await service.resolve(who())).roles).toEqual([]);
    service.invalidateUser(before.userId);
    expect((await service.resolve(who())).roles).toEqual(['admin']);
  });

  it('refuses inactive users and does not cache them', async () => {
    const { directory, service } = setup();
    directory.setActive(OID, false);
    await expect(service.resolve(who())).rejects.toBeInstanceOf(InactiveUserError);
    directory.setActive(OID, true);
    await expect(service.resolve(who())).resolves.toBeDefined();
  });

  it('hands out a read-only, frozen context', async () => {
    const { directory, service } = setup();
    directory.assignUserRole(OID, 'viewer');
    const ctx = await service.resolve(who());
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(Object.isFrozen(ctx.roles)).toBe(true);
    expect(() => (ctx.roles as string[]).push('admin')).toThrow(TypeError);
    expect(() => (ctx.permissions as Set<string>).add('admin.settings')).toThrow(TypeError);
    expect(() => (ctx.projectIds as Set<string>).add('p')).toThrow(TypeError);
    expect(ctx.permissions.has('asset.read')).toBe(true);
    expect(await service.resolve(who())).toBe(ctx);
  });

  describe('across API instances (S1-02 review L3)', () => {
    it('checks is_active on every cache hit, so a deactivated user is refused at once', async () => {
      const { directory, service, loads, activeChecks } = setup();
      directory.assignUserRole(OID, 'viewer');
      await service.resolve(who());
      await service.resolve(who());
      expect(loads()).toBe(1);
      expect(activeChecks()).toBe(1);

      directory.setActive(OID, false); // another instance's admin did this; no notification yet
      await expect(service.resolve(who())).rejects.toBeInstanceOf(InactiveUserError);
      directory.setActive(OID, true);
      await service.resolve(who());
      expect(loads()).toBe(2); // the cache entry was dropped
    });

    it('never caches a load that started before an invalidation', async () => {
      const directory = new InMemoryAccessDirectory();
      directory.assignUserRole(OID, 'viewer');
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let loads = 0;
      const slow: AccessDirectory = {
        upsertUser: directory.upsertUser.bind(directory),
        isUserActive: directory.isUserActive.bind(directory),
        loadAccess: async (...args) => {
          loads += 1;
          const snapshot = await directory.loadAccess(...args); // reads the OLD data ...
          await gate; // ... then the change commits and is announced while we wait
          return snapshot;
        },
      };
      const service = new AccessContextService(slow, () => 1);
      service.setChangeChannelUp(true);

      const pending = service.resolve(who());
      await new Promise((r) => setTimeout(r, 10));
      directory.assignUserRole(OID, 'admin');
      service.invalidateAll(); // the NOTIFY arrives while the load is in flight
      release();
      expect((await pending).roles).toEqual(['viewer']); // this request used what it read ...

      const next = await service.resolve(who()); // ... but nothing stale was cached
      expect(loads).toBe(2);
      expect([...next.roles].sort()).toEqual(['admin', 'viewer']);
    });

    it('a per-user invalidation also blocks caching of loads in flight', async () => {
      const directory = new InMemoryAccessDirectory();
      const { userId } = await directory.upsertUser(who());
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let loads = 0;
      const slow: AccessDirectory = {
        upsertUser: directory.upsertUser.bind(directory),
        isUserActive: directory.isUserActive.bind(directory),
        loadAccess: async (...args) => {
          loads += 1;
          const snapshot = await directory.loadAccess(...args);
          await gate;
          return snapshot;
        },
      };
      const service = new AccessContextService(slow, () => 1);
      service.setChangeChannelUp(true);
      const pending = service.resolve(who());
      await new Promise((r) => setTimeout(r, 10));
      service.invalidateUser(userId);
      release();
      await pending;
      await service.resolve(who());
      expect(loads).toBe(2);
    });

    it('does not use the cache while the change channel is down, and starts empty when it is back', async () => {
      const { directory, service, loads } = setup();
      directory.assignUserRole(OID, 'viewer');
      await service.resolve(who());
      expect(loads()).toBe(1);

      service.setChangeChannelUp(false);
      await service.resolve(who());
      await service.resolve(who());
      expect(loads()).toBe(3); // every request loads, nothing is stored

      service.setChangeChannelUp(true);
      await service.resolve(who());
      expect(loads()).toBe(4); // empty after the outage
      await service.resolve(who());
      expect(loads()).toBe(4); // cached again
    });
  });
});
