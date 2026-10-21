import { randomBytes } from 'node:crypto';
import { testDatabaseAdminUrl } from '@nexus/db/testing';
import pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { LeaderElection } from '../src/leader/leader-election.js';

/**
 * Leader election on a real PostgreSQL (docs/07 section 5). Each test uses its own lock name, so
 * it never competes with a worker running on the same server.
 */
describe.skipIf(testDatabaseAdminUrl === undefined)(
  'leader election (advisory lock)',
  { timeout: 60_000 },
  () => {
    const url = testDatabaseAdminUrl!;
    const lockName = (): string => `nexus-test-leader-${randomBytes(4).toString('hex')}`;
    const appName = `nexus-leader-test-${randomBytes(4).toString('hex')}`; // unique: the failover test ends sessions by this name
    const open: LeaderElection[] = [];
    const make = (name: string): LeaderElection => {
      const e = new LeaderElection({ url, lockName: name, applicationName: appName });
      open.push(e);
      return e;
    };

    afterEach(async () => {
      await Promise.all(open.splice(0).map((e) => e.release()));
    });

    it('only one of two replicas becomes leader; the other stays quiet', async () => {
      const name = lockName();
      const a = make(name);
      const b = make(name);
      expect(await a.ensureLeader()).toBe(true);
      expect(await b.ensureLeader()).toBe(false);
      expect(a.isLeader).toBe(true);
      expect(b.isLeader).toBe(false);
      // The leader keeps it on every later check.
      expect(await a.ensureLeader()).toBe(true);
      expect(await b.ensureLeader()).toBe(false);
    });

    it('two jobs asking at the same moment share one check, so both see the leader', async () => {
      const a = make(lockName());
      const [first, second] = await Promise.all([a.ensureLeader(), a.ensureLeader()]);
      expect([first, second]).toEqual([true, true]);
    });

    it('a released lock goes to the other replica', async () => {
      const name = lockName();
      const a = make(name);
      const b = make(name);
      await a.ensureLeader();
      await a.release();
      expect(a.isLeader).toBe(false);
      expect(await b.ensureLeader()).toBe(true);
    });

    it('a lost connection (failover) is noticed before the next job, and the lock is taken again', async () => {
      const name = lockName();
      const a = make(name);
      expect(await a.ensureLeader()).toBe(true);

      // Kill the leader's session from outside, as a failover or network cut would.
      const killer = new pg.Client({ connectionString: url });
      await killer.connect();
      try {
        await killer.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
          WHERE application_name = $1 AND pid <> pg_backend_pid()`,
          [appName],
        );
      } finally {
        await killer.end();
      }
      await new Promise((r) => setTimeout(r, 200));

      // The lock died with the session. A new check notices, drops the dead connection and
      // takes the lock again (nobody else wanted it), instead of pretending to lead.
      expect(await a.ensureLeader()).toBe(true);
      expect(a.isLeader).toBe(true);
    });

    it('a replica takes over when the leader dies', async () => {
      const name = lockName();
      const a = make(name);
      const b = make(name);
      await a.ensureLeader();
      expect(await b.ensureLeader()).toBe(false);
      await a.release(); // the process ends: its session ends and the lock is gone
      expect(await b.ensureLeader()).toBe(true);
    });

    it('reports not leader (and does not throw) when the database is unreachable', async () => {
      const e = new LeaderElection({
        url: 'postgres://nexus@127.0.0.1:1/nope',
        lockName: lockName(),
      });
      expect(await e.ensureLeader()).toBe(false);
      expect(e.isLeader).toBe(false);
    });
  },
);
