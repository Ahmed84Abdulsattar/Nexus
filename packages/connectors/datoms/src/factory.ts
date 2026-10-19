import {
  BudgetTracker,
  DatomsApi,
  DatomsClient,
  InMemoryBudgetStore,
  InMemoryPageSizeStore,
  assertLive,
  createFixtureConfig,
  createFixtureFetch,
  loadDatomsConfig,
  type Logger,
} from '@nexus/datoms-client';
import type { SourceConnector } from '@nexus/connectors-core';
import { DatomsConnector } from './connector.js';

export interface CreateDatomsConnectorOptions {
  /** DATOMS_LIVE, DATOMS_BASE_URL, DATOMS_ORG_ID, DATOMS_TOKEN. Only `DATOMS_LIVE=true` reaches DATOMS. */
  env: NodeJS.ProcessEnv;
  /** `budget.max_share` (ADR 0005). Default 1. */
  maxShare?: number;
  /** Number of assets in the fleet, for the credit caps. Default 500. */
  fleetSize?: number;
  log?: Logger;
}

export interface DatomsConnectorHandle {
  connector: SourceConnector;
  mode: 'live' | 'fixtures';
}

/**
 * The worker's only way to get DATOMS: a `SourceConnector`. With `DATOMS_LIVE=true` it talks to
 * DATOMS (and throws if the org id or token is missing); otherwise it answers from `fixtures/`
 * through the same client, budget and mapping code, with no network and no secret.
 *
 * TODO(S3-03): persist the budget calls and the learned page size in integration.api_call and
 * integration.cursor (they are in memory here; the catalogue job spends no credits).
 */
export function createDatomsConnector(
  options: CreateDatomsConnectorOptions,
): DatomsConnectorHandle {
  const live = options.env['DATOMS_LIVE'] === 'true';
  const config = live ? loadDatomsConfig(options.env) : createFixtureConfig();
  if (live) assertLive(config);
  const budget = new BudgetTracker({
    fleetSize: options.fleetSize ?? 500,
    maxShare: options.maxShare ?? 1,
  });
  const api = new DatomsApi({
    client: new DatomsClient(config, live ? undefined : createFixtureFetch()),
    budget,
    callStore: new InMemoryBudgetStore(),
    pageSizes: new InMemoryPageSizeStore(),
    ...(options.log ? { log: options.log } : {}),
  });
  return { connector: new DatomsConnector(api), mode: live ? 'live' : 'fixtures' };
}
