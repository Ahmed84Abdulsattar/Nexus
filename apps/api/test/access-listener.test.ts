import 'reflect-metadata';
import { createServer, connect, type Server, type Socket } from 'node:net';
import { createTestDatabase, testDatabaseAdminUrl, type TestDatabase } from '@nexus/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccessChangeListener } from '../src/common/auth/access-change-listener.js';
import { AccessContextService } from '../src/common/auth/access-context.js';
import { InMemoryAccessDirectory } from '../src/common/auth/in-memory-access-directory.js';
import type { AppConfig } from '../src/config/env.js';

const config = (url: string): AppConfig => ({ database: { url, poolMax: 1 } }) as AppConfig;
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function waitFor(condition: () => boolean, what: string, ms = 5000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (condition()) return;
    await wait(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** A TCP relay to the real server that can be frozen: the connection stays open but nothing moves (a half-open connection). */
class FreezableProxy {
  frozen = false;
  readonly server: Server;
  private readonly sockets: Socket[] = [];
  constructor(private readonly target: { host: string; port: number }) {
    this.server = createServer((client) => {
      const upstream = connect(this.target.port, this.target.host);
      this.sockets.push(client, upstream);
      client.on('data', (d) => !this.frozen && upstream.write(d));
      upstream.on('data', (d) => !this.frozen && client.write(d));
      client.on('error', () => upstream.destroy());
      upstream.on('error', () => client.destroy());
      client.on('close', () => upstream.destroy());
      upstream.on('close', () => client.destroy());
    });
  }
  async start(): Promise<number> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    return (this.server.address() as { port: number }).port;
  }
  async stop(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    await new Promise((resolve) => this.server.close(resolve));
  }
}

describe('AccessChangeListener refuses the pooler port (M4)', () => {
  it('throws at startup for port 6432', () => {
    const listener = new AccessChangeListener(
      config('postgres://u@db.example:6432/d'),
      new AccessContextService(new InMemoryAccessDirectory(), () => 0),
    );
    expect(() => listener.onApplicationBootstrap()).toThrow(/6432/);
  });
});

describe.skipIf(testDatabaseAdminUrl === undefined)('AccessChangeListener probe (M4)', () => {
  let testDb: TestDatabase;
  beforeAll(async () => {
    testDb = await createTestDatabase();
  });
  afterAll(async () => {
    await testDb?.drop();
  });

  it('marks the channel up only after its own probe came back, and the cache starts closed (L3)', async () => {
    let loads = 0;
    const directory = new InMemoryAccessDirectory();
    const counting = new AccessContextService(
      { ...bind(directory), loadAccess: (...a) => (loads++, directory.loadAccess(...a)) },
      () => Date.now(),
    );
    const identity = { oid: 'aaaaaaaa-0000-4000-8000-000000000001', tenantId: 't', groupIds: [] };
    await counting.resolve(identity);
    await counting.resolve(identity);
    expect(loads).toBe(2); // fails closed: nothing cached before a listener has proven itself

    const listener = new AccessChangeListener(config(testDb.adminUrl), counting);
    listener.onApplicationBootstrap();
    try {
      await waitFor(() => listener.isListening, 'the first probe to come back');
      await counting.resolve(identity);
      await counting.resolve(identity);
      expect(loads).toBe(3); // cached now
    } finally {
      await listener.onApplicationShutdown();
    }
  });

  it('treats a connection that stays open but hears nothing as lost, within the probe timeout', async () => {
    const url = new URL(testDb.adminUrl);
    const proxy = new FreezableProxy({ host: url.hostname, port: Number(url.port || 5432) });
    const port = await proxy.start();
    const throughProxy = new URL(testDb.adminUrl);
    throughProxy.hostname = '127.0.0.1';
    throughProxy.port = String(port);

    const directory = new InMemoryAccessDirectory();
    let loads = 0;
    const service = new AccessContextService(
      { ...bind(directory), loadAccess: (...a) => (loads++, directory.loadAccess(...a)) },
      () => Date.now(),
    );
    const listener = new AccessChangeListener(config(throughProxy.toString()), service, {
      probeIntervalMs: 100,
      probeTimeoutMs: 400,
    });
    listener.onApplicationBootstrap();
    try {
      await waitFor(() => listener.isListening, 'the listener to come up through the proxy');
      const identity = { oid: 'aaaaaaaa-0000-4000-8000-000000000002', tenantId: 't', groupIds: [] };
      await service.resolve(identity);
      await service.resolve(identity);
      expect(loads).toBe(1);

      proxy.frozen = true; // a half-open connection: no error, no close, no data
      await waitFor(() => !listener.isListening, 'the missed probe to be noticed', 3000);
      await service.resolve(identity);
      await service.resolve(identity);
      expect(loads).toBe(3); // the cache is off while the channel is not proven
    } finally {
      await listener.onApplicationShutdown();
      await proxy.stop();
    }
  });
});

function bind(
  d: InMemoryAccessDirectory,
): Pick<InMemoryAccessDirectory, 'upsertUser' | 'isUserActive'> {
  return { upsertUser: d.upsertUser.bind(d), isUserActive: d.isUserActive.bind(d) };
}
