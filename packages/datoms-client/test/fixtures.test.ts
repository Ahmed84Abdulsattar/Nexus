import { describe, expect, it } from 'vitest';
import {
  BudgetTracker,
  DatomsApi,
  DatomsClient,
  InMemoryPageSizeStore,
  createFixtureConfig,
  createFixtureFetch,
} from '../src/index.js';

function fixtureApi(): { api: DatomsApi; fetchCalls: string[] } {
  const inner = createFixtureFetch();
  const fetchCalls: string[] = [];
  const spy = ((input: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push(`${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`);
    return inner(input, init);
  }) as typeof fetch;
  const api = new DatomsApi({
    client: new DatomsClient(createFixtureConfig(), spy),
    budget: new BudgetTracker({ fleetSize: 500, maxShare: 1 }),
    pageSizes: new InMemoryPageSizeStore(),
  });
  return { api, fetchCalls };
}

describe('fixture mode (DATOMS_LIVE=false)', () => {
  it('serves the Asset List through the real client and paging walker', async () => {
    const { api, fetchCalls } = fixtureApi();
    const cat = await api.collectAssets(1000);
    expect(cat).toMatchObject({ total: 22, complete: true });
    expect(cat.assets).toHaveLength(22);
    expect(fetchCalls).toEqual(['GET /v4/orgs/fixture/assets']);
  });

  it('serves fleet mode and id mode from the recorded fleet page', async () => {
    const { api } = fixtureApi();
    const readings = [];
    for await (const page of api.walkFleet()) readings.push(...page.readings);
    expect(readings).toHaveLength(22);

    const byId = await api.bulkByIds(['33850', '99999999']);
    expect(byId.readings.map((r) => r.externalAssetId)).toEqual(['33850']);
    expect(byId.noData).toEqual(['99999999']);
  });

  it('holds no secret: the config redacts, and nothing outside the bulk and list paths answers', async () => {
    const cfg = createFixtureConfig();
    expect(JSON.stringify(cfg)).toContain('[redacted]');
    expect(JSON.stringify(cfg)).not.toContain('fixture-no-secret');
    const res = await createFixtureFetch()('https://api.datoms.io/v4/orgs/x/assets/1/other', {});
    expect(res.status).toBe(404);
  });
});
