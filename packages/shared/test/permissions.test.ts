import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { isPermissionKey, PERMISSION_KEYS } from '../src/index.js';

it('has unique keys that match the seed in db/schema.sql', () => {
  expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  const sql = readSchema();
  const seeded = [...sql.matchAll(/^\s*\('([a-z_.]+)',\s+'/gm)].map((m) => m[1]);
  for (const key of PERMISSION_KEYS) expect(seeded).toContain(key);
});

it('isPermissionKey narrows', () => {
  expect(isPermissionKey('asset.read')).toBe(true);
  expect(isPermissionKey('asset.write')).toBe(false);
});

function readSchema(): string {
  return readFileSync(fileURLToPath(new URL('../../../db/schema.sql', import.meta.url)), 'utf8');
}
