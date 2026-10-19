import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';

// Belt and braces beside the ESLint rule (packages/config boundaries test, hard rule 7): no source
// file outside components/map/arcgis/ mentions an @arcgis package.
const SRC = join(process.cwd(), 'src');

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.(tsx?|css)$/.test(e.name) ? [p] : [];
  });
}

it('imports @arcgis/* only inside components/map/arcgis/', () => {
  const offenders = files(SRC)
    .map((f) => relative(SRC, f).replaceAll('\\', '/'))
    .filter((rel) => !rel.startsWith('components/map/arcgis/'))
    .filter((rel) => /@arcgis\//.test(readFileSync(join(SRC, rel), 'utf8')));
  expect(offenders).toEqual([]);
});

it('keeps the adapter lazy: only MapView.tsx references the adapter, through import()', () => {
  const users = files(SRC)
    .map((f) => relative(SRC, f).replaceAll('\\', '/'))
    .filter((rel) => !rel.startsWith('components/map/arcgis/'))
    .filter((rel) => /arcgis\/ArcgisMap/.test(readFileSync(join(SRC, rel), 'utf8')));
  expect(users).toEqual(['components/map/MapView.tsx']);
  expect(readFileSync(join(SRC, 'components/map/MapView.tsx'), 'utf8')).toMatch(
    /lazy\(\s*\(\)\s*=>\s*import\(['"]\.\/arcgis\/ArcgisMap['"]\)/,
  );
});
