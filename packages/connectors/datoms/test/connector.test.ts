import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  InMemoryCatalogueRepository,
  runCatalogueSync,
  type AssetTypeRef,
  type SourceConnector,
} from '@nexus/connectors-core';
import {
  BudgetTracker,
  DatomsApi,
  DatomsClient,
  InMemoryPageSizeStore,
  createDatomsConfig,
} from '@nexus/datoms-client';
import { DatomsConnector } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..');

function fixture(name: string): { body: unknown } {
  return JSON.parse(
    readFileSync(join(root, 'packages', 'datoms-client', 'fixtures', name), 'utf8'),
  ) as { body: unknown };
}

/**
 * Asset types as the database seeds them: codes from db/schema.sql, DATOMS category names from
 * db/seeds/datoms-parameters.sql. Read from the files so the test cannot drift from the seed.
 */
function seededTypes(): AssetTypeRef[] {
  const schema = readFileSync(join(root, 'db', 'schema.sql'), 'utf8');
  const block = schema.slice(schema.indexOf('INSERT INTO core.asset_type'));
  const codes = [...block.slice(0, block.indexOf(';')).matchAll(/\('(\w+)',\s*'[^']*',/g)].map(
    (m) => m[1]!,
  );
  const seed = readFileSync(join(root, 'db', 'seeds', 'datoms-parameters.sql'), 'utf8');
  const part = seed.slice(
    seed.indexOf('SET source_names'),
    seed.indexOf('AS m(code, source_name)'),
  );
  const pairs = [...part.matchAll(/\('(\w+)',\s*'([^']+)'\)/g)];
  return codes.map((code) => ({
    id: `type-${code}`,
    code,
    sourceNames: pairs.filter((p) => p[1] === code).map((p) => p[2]!),
  }));
}

function connectorFor(listBody: unknown, status = 200) {
  const config = createDatomsConfig(
    { baseUrl: 'https://datoms.test/v4', orgId: '20283', token: 'TEST-TOKEN', live: true },
    { extraAllowedHosts: ['datoms.test'] },
  );
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    return new Response(JSON.stringify(listBody), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  const api = new DatomsApi({
    client: new DatomsClient(config, fetchImpl),
    budget: new BudgetTracker({ fleetSize: 500, maxShare: 1 }),
    pageSizes: new InMemoryPageSizeStore(),
  });
  return { connector: new DatomsConnector(api), calls };
}

describe('DatomsConnector', () => {
  it('implements SourceConnector and calls only GET /assets for the catalogue', async () => {
    const { connector, calls } = connectorFor(fixture('assets-list-page1.json').body);
    const c: SourceConnector = connector;
    const cat = await c.listAssets();
    expect(c.sourceSystem).toBe('datoms');
    expect(cat).toMatchObject({ total: 22, complete: true });
    expect(cat.assets).toHaveLength(22);
    expect(calls).toEqual(['/v4/orgs/20283/assets?page=1&limit=1000']);
    // site, kind and status are absent, not defaulted
    expect(cat.assets.every((a) => a.siteExternalId === undefined && a.kind === undefined)).toBe(
      true,
    );
  });

  it('reports an incomplete walk when the total does not match', async () => {
    const body = structuredClone(fixture('assets-list-page1.json').body) as {
      pagination: { total: number };
    };
    body.pagination.total = 23;
    const { connector } = connectorFor(body);
    expect((await connector.listAssets()).complete).toBe(false);
  });

  it('syncs the 22 fixture assets: all map to the seeded types, none to generic', async () => {
    const types = seededTypes();
    expect(types.map((t) => t.code)).toEqual(
      expect.arrayContaining(['diesel_generator', 'fuel_tank', 'mains', 'solar', 'generic']),
    );
    const repo = new InMemoryCatalogueRepository(types);
    const { connector } = connectorFor(fixture('assets-list-page1.json').body);
    const { summary } = await runCatalogueSync({
      connector,
      repo,
      settings: { retireAfterMisses: 2, retireMaxFraction: 0.05 },
    });
    expect(summary).toMatchObject({ read: 22, inserted: 22, complete: true });
    const byType = new Map<string, number>();
    for (const a of repo.assets.values()) {
      const code = types.find((t) => t.id === a.assetTypeId)!.code;
      byType.set(code, (byType.get(code) ?? 0) + 1);
    }
    expect(Object.fromEntries(byType)).toEqual({
      diesel_generator: 8,
      fuel_tank: 1,
      mains: 12,
      solar: 1,
    });
    // No unknown category: the only link_todos are the missing sites (Q21/Q22).
    expect([...repo.todos.values()].every((t) => t.reason === 'no_site')).toBe(true);
    expect([...repo.assets.values()].every((a) => a.projectId === null)).toBe(true);
    // nameplate is kept as DATOMS sent it
    expect(repo.assets.get('43644')!.nameplate).toMatchObject({ capacity: 20000, make: null });
  });
});
