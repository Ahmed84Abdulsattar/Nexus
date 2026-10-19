// Fixture recorder. Saves ONLY the response body plus a small meta block
// (endpoint path without host, method, date, HTTP status, rate-limit response headers).
// Never the token, never request headers, never the host or org id in a header.
//
// Run through live.ts (`pnpm --filter @nexus/datoms-client live ...`).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redact, type DatomsResponse } from '../src/index.js';

// Works from scripts/ (source) and from .cli-build/scripts/ (compiled): walk up to the package root.
function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'package.json'))) dir = dirname(dir);
  return dir;
}
export const FIXTURES_DIR = join(packageRoot(), 'fixtures');

const FIXTURE_NAME = /^[\w.-]+\.json$/;
const SECRET_SHAPE = /Bearer\s|authorization/i;

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

/** Resolves a fixture name inside `dir`, or throws. */
export function fixturePath(name: string, dir: string = FIXTURES_DIR): string {
  if (!FIXTURE_NAME.test(name)) throw new Error('Invalid fixture name.');
  const full = resolve(dir, name);
  const rel = relative(resolve(dir), full);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Fixture path escapes the fixtures directory.');
  }
  return full;
}

/** The text that would be written. Redacts the token and refuses anything that looks like a credential. */
export function serializeFixture(
  method: string,
  endpoint: string,
  res: DatomsResponse,
  token = '',
): string {
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
  const text = redact(JSON.stringify(file, null, 2), token) + '\n';
  if (SECRET_SHAPE.test(text)) {
    throw new Error('Refusing to write the fixture: it looks like it contains a credential.');
  }
  return text;
}

export function saveFixture(
  name: string,
  method: string,
  endpoint: string,
  res: DatomsResponse,
  token = '',
  dir: string = FIXTURES_DIR,
): string {
  const path = fixturePath(name, dir);
  const text = serializeFixture(method, endpoint, res, token);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, text);
  return path;
}
