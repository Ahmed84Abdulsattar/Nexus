import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BudgetTracker,
  DatomsApi,
  DatomsClient,
  InMemoryBudgetStore,
  InMemoryPageSizeStore,
  createDatomsConfig,
  type DatomsConfig,
  type Logger,
  type RawAsset,
  type RawBulkRow,
} from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));

export function fixture<T = unknown>(name: string): { meta: Record<string, unknown>; body: T } {
  return JSON.parse(readFileSync(join(here, '..', 'fixtures', name), 'utf8')) as {
    meta: Record<string, unknown>;
    body: T;
  };
}

export const TEST_TOKEN = 'SECRET-TEST-TOKEN-123';

export const testConfig: DatomsConfig = createDatomsConfig(
  { baseUrl: 'https://datoms.test/v4', orgId: '20283', token: TEST_TOKEN, live: true },
  { extraAllowedHosts: ['datoms.test'] },
);

export interface FakeReply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface FakeCall {
  method: string;
  path: string;
  body: unknown;
}

/** A fake fetch. `handler` sees the path (without host) and the parsed JSON body. */
export function fakeFetch(handler: (call: FakeCall, n: number) => FakeReply | Promise<FakeReply>) {
  const calls: FakeCall[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const call: FakeCall = {
      method: init?.method ?? 'GET',
      path: url.pathname.replace('/v4/orgs/20283', '') + url.search,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const r = await handler(call, calls.length);
    const status = r.status ?? 200;
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status,
      headers: { 'content-type': 'application/json', ...r.headers },
    });
  }) as typeof fetch;
  return { impl, calls };
}

export function errorReply(status: number, code: string, headers?: Record<string, string>) {
  return {
    status,
    body: { success: false, status: 'failure', error: { code, message: code } },
    headers,
  } satisfies FakeReply;
}

export function memoryLogger() {
  const lines: string[] = [];
  const push = (level: string) => (msg: string, fields?: Record<string, unknown>) => {
    lines.push(`${level} ${msg} ${JSON.stringify(fields ?? {})}`);
  };
  const log: Logger = { info: push('info'), warn: push('warn'), error: push('error') };
  return { log, lines };
}

export function syntheticAssets(n: number): RawAsset[] {
  const base = fixture<{ data: RawAsset[] }>('assets-list-page1.json').body.data;
  return Array.from({ length: n }, (_, i) => ({ ...base[i % base.length]!, id: String(1000 + i) }));
}

export function syntheticRows(n: number): RawBulkRow[] {
  const row = fixture<{ data: RawBulkRow[] }>('bulk-latest-id-mode.json').body.data[0]!;
  return Array.from({ length: n }, (_, i) => ({ ...row, asset_id: String(1000 + i) }));
}

export interface ApiRig {
  api: DatomsApi;
  budget: BudgetTracker;
  waits: number[];
  callStore: InMemoryBudgetStore;
  pageSizes: InMemoryPageSizeStore;
  lines: string[];
  clock: { t: number };
}

export function rig(
  fetchImpl: typeof fetch,
  opts: { fleetSize?: number; maxShare?: number; pageSizes?: InMemoryPageSizeStore } = {},
): ApiRig {
  const clock = { t: Date.parse('2026-10-12T12:00:00Z') };
  const waits: number[] = [];
  const budget = new BudgetTracker({
    fleetSize: opts.fleetSize ?? 500,
    maxShare: opts.maxShare ?? 1,
    now: () => clock.t,
  });
  const callStore = new InMemoryBudgetStore();
  const pageSizes = opts.pageSizes ?? new InMemoryPageSizeStore();
  const { log, lines } = memoryLogger();
  const api = new DatomsApi({
    client: new DatomsClient(testConfig, fetchImpl),
    budget,
    callStore,
    pageSizes,
    log,
    sleep: (ms) => {
      waits.push(ms);
      clock.t += ms; // time passes while we wait, so sliding windows empty
      return Promise.resolve();
    },
    maxBudgetWaitMs: 120_000,
    now: () => clock.t,
    retry: { random: () => 0.5 },
  });
  return { api, budget, waits, callStore, pageSizes, lines, clock };
}
