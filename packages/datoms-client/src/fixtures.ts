import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDatomsConfig, type DatomsConfig } from './config.js';
import {
  ASSET_LIST_PATH,
  BULK_LATEST_PATH,
  bulkRowId,
  noDataRow,
  parseBulkRequest,
  withoutRows,
  type RawAssetList,
  type RawBulkResponse,
} from './mapping.js';

/**
 * Fixture mode (DATOMS_LIVE=false): the same DatomsClient / DatomsApi code runs, but the `fetch`
 * behind it answers from the recorded responses in `fixtures/`. No network, no token. The fixtures
 * are real DATOMS bodies with tokens and headers removed (docs/07 section 4 item 9). Raw field
 * names are read through helpers in mapping.ts, never here.
 */

/** The `fixtures/` folder of this package (next to `src/` and `dist/`). */
export function fixturesDir(): string {
  return fileURLToPath(new URL('../fixtures/', import.meta.url));
}

/** A config that passes `assertLive` but holds no secret. Only usable with `createFixtureFetch`. */
export function createFixtureConfig(): DatomsConfig {
  return createDatomsConfig({ orgId: 'fixture', token: 'fixture-no-secret', live: true });
}

interface Recorded<T> {
  meta?: { rateLimit?: { unit?: string; limit?: string; remaining?: string; reset?: string } };
  body: T;
}

function load<T>(dir: string, name: string): Recorded<T> {
  return JSON.parse(readFileSync(`${dir}${name}`, 'utf8')) as Recorded<T>;
}

export interface FixtureNames {
  assetList: string;
  fleet: string;
}

export const DEFAULT_FIXTURES: FixtureNames = {
  assetList: 'assets-list-page1.json',
  fleet: 'bulk-fleet-page1-run1.json',
};

/**
 * A `fetch` that serves the Asset List and the bulk endpoint from fixtures:
 * - `GET /assets` returns the recorded list (page 1; later pages are empty).
 * - `POST .../telemetry/latest/query` in fleet mode returns the recorded fleet page; in id mode it
 *   returns one row per requested id from the same recording, `success: false` for unknown ids.
 * Anything else is a 404 with the DATOMS error shape.
 */
export function createFixtureFetch(
  dir: string = fixturesDir(),
  names: FixtureNames = DEFAULT_FIXTURES,
): typeof fetch {
  const list = load<RawAssetList>(dir, names.assetList);
  const fleet = load<RawBulkResponse>(dir, names.fleet);

  const reply = (body: unknown, rec?: Recorded<unknown>, status = 200): Response => {
    const rl = rec?.meta?.rateLimit;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (rl?.unit) headers['x-ratelimit-unit'] = rl.unit;
    if (rl?.limit) headers['x-ratelimit-limit'] = rl.limit;
    if (rl?.remaining) headers['x-ratelimit-remaining'] = rl.remaining;
    if (rl?.reset) headers['x-ratelimit-reset'] = rl.reset;
    return new Response(JSON.stringify(body), { status, headers });
  };
  const notFound = (): Response =>
    reply(
      { success: false, status: 'failure', error: { code: 'NOT_FOUND', message: 'fixture' } },
      undefined,
      404,
    );

  return ((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const path = url.pathname.replace(/^.*\/orgs\/[^/]+/, '');
    if (method === 'GET' && path === ASSET_LIST_PATH) {
      const page = Number(url.searchParams.get('page') ?? '1');
      return Promise.resolve(reply(page > 1 ? withoutRows(list.body) : list.body, list));
    }
    if (method === 'POST' && path === BULK_LATEST_PATH) {
      const req = parseBulkRequest(init?.body ? JSON.parse(String(init.body)) : undefined);
      if (req.mode === 'ids') {
        const byId = new Map(fleet.body.data.map((r) => [bulkRowId(r), r]));
        const data = req.ids.map((id) => byId.get(id) ?? noDataRow(id));
        return Promise.resolve(reply({ success: true, status: 'success', data }, fleet));
      }
      return Promise.resolve(reply(req.page > 1 ? withoutRows(fleet.body) : fleet.body, fleet));
    }
    return Promise.resolve(notFound());
  }) as typeof fetch;
}
