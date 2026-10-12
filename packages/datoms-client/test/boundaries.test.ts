import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Acceptance checks for S2-02:
// 1. Nothing outside packages/datoms-client/scripts/ calls GET /assets/{id}/data/latest (ADR 0010).
// 2. DATOMS JSON field names live only in src/mapping.ts.

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, '..');
const repo = join(pkg, '..', '..');

const SKIP = new Set([
  'node_modules',
  'dist',
  '.cli-build',
  'build',
  '.turbo',
  'coverage',
  'fixtures',
  '.git',
  '.claude',
]);

function* tsFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* tsFiles(p);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(name)) yield p;
  }
}

const rel = (p: string) => relative(repo, p).split(sep).join('/');

describe('data/latest is CLI-only', () => {
  it('no file outside packages/datoms-client/scripts/ mentions the endpoint or a getLatest call', () => {
    const offenders: string[] = [];
    for (const dir of ['apps', 'packages']) {
      for (const file of tsFiles(join(repo, dir))) {
        const r = rel(file);
        if (r.startsWith('packages/datoms-client/scripts/')) continue;
        if (r === 'packages/datoms-client/test/boundaries.test.ts') continue;
        const text = readFileSync(file, 'utf8');
        if (/data\/latest|getLatestForAsset/.test(text)) offenders.push(r);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the scripts do use it (so this check is not vacuous)', () => {
    const text = readFileSync(join(pkg, 'scripts', 'live.ts'), 'utf8');
    expect(text).toMatch(/data\/latest/);
  });
});

describe('DATOMS field names live only in src/mapping.ts', () => {
  const FIELD_NAMES = [
    'category_name',
    'category_id',
    'lifecycle_status',
    'asset_info',
    'created_at',
    'total_pages',
    'asset_ids',
    'asset_id',
  ];
  it('no other file under src/ uses them', () => {
    const offenders: string[] = [];
    for (const file of tsFiles(join(pkg, 'src'))) {
      if (file.endsWith(`${sep}mapping.ts`)) continue;
      const text = readFileSync(file, 'utf8');
      for (const f of FIELD_NAMES) {
        if (new RegExp(`\\b${f}\\b`).test(text)) offenders.push(`${rel(file)}: ${f}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
