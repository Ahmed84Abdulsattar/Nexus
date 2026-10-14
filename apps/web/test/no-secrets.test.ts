import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

// S0-09 acceptance 4: no ArcGIS key in the repo. Scans every git-tracked file (so never .env, which
// is git-ignored and never read here). dist/ is checked by scripts/check-dist.mjs after the build.
const repoRoot = join(process.cwd(), '..', '..');
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
  .split('\0')
  .filter((f) => f && !/\.(png|jpe?g|gif|ico|woff2?)$/.test(f) && f !== 'pnpm-lock.yaml');

// ArcGIS API keys start with AAPK (legacy) or AAPT (new) followed by a long token.
const KEY = /AAP[KT][A-Za-z0-9_-]{30,}/;
// `ARCGIS_API_KEY=<value>` or `VITE_DEV_ARCGIS_API_KEY=<value>` with an actual value.
const ASSIGNED = /\b(?:VITE_DEV_)?ARCGIS_API_KEY\s*[:=]\s*['"]?[A-Za-z0-9_-]{8,}/;
// A key put in a URL: ?token=... / ?apiKey=... with a value.
const URL_KEY = /[?&](?:token|apiKey)=[A-Za-z0-9_-]{16,}/i;

it('has tracked files to scan', () => {
  expect(tracked.length).toBeGreaterThan(50);
});

it('no tracked file contains an ArcGIS key', () => {
  const offenders: string[] = [];
  for (const file of tracked) {
    let text: string;
    try {
      text = readFileSync(join(repoRoot, file), 'utf8');
    } catch {
      continue; // a tracked file deleted in the working tree
    }
    if ([KEY, ASSIGNED, URL_KEY].some((re) => re.test(text))) offenders.push(file);
  }
  expect(offenders).toEqual([]);
});

it('.env.example lists the dev key variable with no value', () => {
  const example = readFileSync(join(repoRoot, '.env.example'), 'utf8');
  expect(example).toMatch(/^VITE_DEV_ARCGIS_API_KEY=$/m);
  expect(example).toMatch(/^ARCGIS_API_KEY=$/m);
});
