// Fixture recorder. Saves ONLY the response body plus a small meta block
// (endpoint path without host, method, date, HTTP status, rate-limit response headers).
// Never the token, never request headers, never the host or org id in a header.
//
// Run through live.ts. Needs a built package: `pnpm --filter @nexus/datoms-client build`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatomsResponse } from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = join(here, '..', 'fixtures');

export interface FixtureFile {
  meta: {
    endpoint: string;
    method: string;
    date: string;
    status: number;
    rateLimit: DatomsResponse['rateLimit'];
  };
  body: unknown;
}

export function saveFixture(
  name: string,
  method: string,
  endpoint: string,
  res: DatomsResponse,
): string {
  mkdirSync(FIXTURES_DIR, { recursive: true });
  const file: FixtureFile = {
    meta: {
      endpoint,
      method,
      date: new Date().toISOString(),
      status: res.status,
      rateLimit: res.rateLimit,
    },
    // Success: the body. Failure: the DATOMS error envelope only.
    body: res.ok ? res.body : { success: false, status: 'failure', error: res.error },
  };
  const path = join(FIXTURES_DIR, name);
  writeFileSync(path, JSON.stringify(file, null, 2) + '\n');
  return path;
}
