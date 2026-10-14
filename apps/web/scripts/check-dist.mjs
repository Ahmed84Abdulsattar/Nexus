// Post-build checks on dist/ (S0-09 acceptance 2 and 4). Runs after `vite build`; fails the build.
//   1. ArcGIS is only reachable through the lazy map adapter: the first-load script graph (index.html
//      and its static imports) contains no ArcGIS chunk, so /admin/users never loads one.
//   2. Size budget (docs/09 section 5): no single ArcGIS chunk and not the adapter's static graph is
//      over 2 MB gzipped. The SDK is split into ~1,100 lazy chunks; what a map load really downloads
//      is measured by scripts/measure-map-load.mjs.
//   3. dist/ holds no ArcGIS key, no MSW, no mock worker script and none of the sample data.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { posix, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { gzipSync } from 'node:zlib';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const MAX_GZIP = 2 * 1024 * 1024;
const problems = [];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const all = walk(dist);
const rel = (p) => relative(dist, p).replaceAll('\\', '/');
const js = all.filter((p) => p.endsWith('.js'));
const text = new Map(js.map((p) => [rel(p), readFileSync(p, 'utf8')]));
const gz = (name) => gzipSync(text.get(name)).length;

// Static import graph (dynamic import() calls are the lazy boundaries and are not followed).
const staticRe = /(?:\bfrom|\bimport)\s*["'](\.{1,2}\/[^"']+\.js)["']/g;
function staticClosure(start) {
  const seen = new Set();
  const stack = [start];
  while (stack.length) {
    const name = stack.pop();
    if (seen.has(name) || !text.has(name)) continue;
    seen.add(name);
    for (const m of text.get(name).matchAll(staticRe)) {
      stack.push(posix.normalize(posix.join(posix.dirname(name), m[1])));
    }
  }
  return seen;
}

const isArcgis = (name) => name.startsWith('assets/arcgis/');
const arcgisFiles = [...text.keys()].filter(isArcgis);
if (arcgisFiles.length === 0) problems.push('No ArcGIS chunk found under assets/arcgis/.');

// 1. First-load graph.
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const firstLoad = new Set();
for (const m of html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)) {
  for (const f of staticClosure(m[1])) firstLoad.add(f);
}
const leaked = [...firstLoad].filter(isArcgis);
if (leaked.length)
  problems.push(`First-load graph pulls ArcGIS chunks: ${leaked.slice(0, 3).join(', ')}`);
if (/arcgis/i.test(html)) problems.push('index.html mentions ArcGIS.');

// 2. Budget.
const adapter = [...text.keys()].find((n) => /^assets\/(?:arcgis\/)?ArcgisMap-/.test(n));
if (!adapter) problems.push('No ArcgisMap chunk found.');
const biggest = arcgisFiles.map((n) => [n, gz(n)]).sort((a, b) => b[1] - a[1])[0];
if (biggest && biggest[1] > MAX_GZIP)
  problems.push(`${biggest[0]} is ${biggest[1]} B gzipped (> 2 MB).`);
const adapterStatic = adapter ? [...staticClosure(adapter)].reduce((s, n) => s + gz(n), 0) : 0;
if (adapterStatic > MAX_GZIP)
  problems.push(`Map adapter static graph is ${adapterStatic} B gzipped (> 2 MB).`);

// 3. Secrets and test-only code.
const FORBIDDEN = [
  [/AAP[KT][A-Za-z0-9_-]{30,}/, 'an ArcGIS API key'],
  [/VITE_DEV_ARCGIS_API_KEY/, 'the dev key variable name'],
  [/mockServiceWorker|setupWorker|Mock Service Worker/, 'MSW'],
  [/Sample project \d\d|sample-0\d/, 'sample markers'],
];
for (const p of all) {
  if (/\.(png|jpe?g|woff2?|ico|map)$/.test(p)) continue;
  if (rel(p) === 'mockServiceWorker.js') problems.push('dist/ contains mockServiceWorker.js.');
  const content = text.get(rel(p)) ?? readFileSync(p, 'utf8');
  for (const [re, what] of FORBIDDEN) {
    if (re.test(content)) problems.push(`${rel(p)} contains ${what}.`);
  }
}

const mb = (n) => (n / 1048576).toFixed(2);
console.log(
  `check-dist: ${arcgisFiles.length} ArcGIS chunks (${mb(arcgisFiles.reduce((s, n) => s + gz(n), 0))} MB gzipped in total, largest ${biggest ? mb(biggest[1]) : 0} MB), ` +
    `adapter static graph ${mb(adapterStatic)} MB, first-load graph ${firstLoad.size} file(s) with no ArcGIS chunk.`,
);
if (problems.length) {
  console.error(`check-dist FAILED:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('check-dist: OK');
