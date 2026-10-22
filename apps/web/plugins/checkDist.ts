import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Plugin } from 'vite';

/**
 * Post-build checks on the written bundle (S0-09 acceptance 2 and 4). A Vite plugin with a
 * `closeBundle` hook, so every build path (`vite build`, turbo, a direct CI call) runs it. A problem
 * fails the build.
 *   1. ArcGIS is reachable only through the lazy map adapter: the first-load script graph holds no
 *      ArcGIS chunk, so /admin/users never loads one.
 *   2. Size budget (docs/09 section 5): no single ArcGIS chunk and not the adapter's static graph is
 *      over 2 MB gzipped. The SDK is ~1,000 lazy chunks; what a map load really downloads is
 *      measured by scripts/measure-map-load.mjs.
 *   3. No ArcGIS key, MSW, mock worker or sample data anywhere in dist/ (source maps included).
 */
const MAX_GZIP = 2 * 1024 * 1024;

export const FORBIDDEN: [RegExp, string][] = [
  [/AAP[KT][A-Za-z0-9_-]{30,}/, 'an ArcGIS API key'],
  [/VITE_DEV_ARCGIS_API_KEY/, 'the dev key variable name'],
  [/mockServiceWorker|setupWorker|Mock Service Worker/, 'MSW'],
  [/Sample project \d\d|sample-0\d/, 'sample markers'],
  // Local dev sign-in (docs/08): none of it may reach a deployed bundle.
  [
    /dev\/token|nexus\.devAuth|Local development sign-in|VITE_AUTH_MODE|VITE_USE_MOCKS/,
    'local dev sign-in code',
  ],
];
const BINARY = /\.(png|jpe?g|gif|woff2?|ttf|ico|wasm)$/;
const STATIC_IMPORT = /(?:\bfrom|\bimport)\s*["'](\.{1,2}\/[^"']+\.js)["']/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

export function checkDist(): Plugin {
  let outDir = '';
  return {
    name: 'nexus-check-dist',
    apply: 'build',
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
    },
    closeBundle: {
      order: 'post',
      handler() {
        const problems: string[] = [];
        const rel = (p: string) => relative(outDir, p).replaceAll('\\', '/');
        const all = walk(outDir);
        const js = new Map(
          all.filter((p) => p.endsWith('.js')).map((p) => [rel(p), readFileSync(p, 'utf8')]),
        );
        const gz = (name: string) => gzipSync(js.get(name) ?? '').length;

        const staticClosure = (start: string) => {
          const seen = new Set<string>();
          const stack = [start];
          while (stack.length) {
            const name = stack.pop() as string;
            if (seen.has(name) || !js.has(name)) continue;
            seen.add(name);
            for (const m of (js.get(name) as string).matchAll(STATIC_IMPORT)) {
              stack.push(posix.normalize(posix.join(posix.dirname(name), m[1] as string)));
            }
          }
          return seen;
        };

        const isArcgis = (name: string) => name.startsWith('assets/arcgis/');
        const arcgisFiles = [...js.keys()].filter(isArcgis);
        if (arcgisFiles.length === 0) problems.push('No ArcGIS chunk found under assets/arcgis/.');

        // 1. First-load graph.
        const html = readFileSync(join(outDir, 'index.html'), 'utf8');
        const firstLoad = new Set<string>();
        for (const m of html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)) {
          for (const f of staticClosure(m[1] as string)) firstLoad.add(f);
        }
        const leaked = [...firstLoad].filter(isArcgis);
        if (leaked.length) problems.push(`First-load graph pulls ArcGIS chunks: ${leaked[0]}`);
        if (/arcgis/i.test(html)) problems.push('index.html mentions ArcGIS.');

        // 2. Budget.
        const adapter = [...js.keys()].find((n) => /^assets\/(?:arcgis\/)?ArcgisMap-/.test(n));
        if (!adapter) problems.push('No ArcgisMap chunk found.');
        const biggest = arcgisFiles.map((n) => [n, gz(n)] as const).sort((a, b) => b[1] - a[1])[0];
        if (biggest && biggest[1] > MAX_GZIP) {
          problems.push(`${biggest[0]} is ${biggest[1]} B gzipped (> 2 MB).`);
        }
        const adapterStatic = adapter
          ? [...staticClosure(adapter)].reduce((sum, n) => sum + gz(n), 0)
          : 0;
        if (adapterStatic > MAX_GZIP) {
          problems.push(`Map adapter static graph is ${adapterStatic} B gzipped (> 2 MB).`);
        }

        // 3. Secrets and test-only code, in every non-binary file including source maps.
        for (const path of all) {
          if (BINARY.test(path)) continue;
          if (rel(path) === 'mockServiceWorker.js')
            problems.push('dist/ has mockServiceWorker.js.');
          const content = js.get(rel(path)) ?? readFileSync(path, 'utf8');
          for (const [re, what] of FORBIDDEN) {
            if (re.test(content)) problems.push(`${rel(path)} contains ${what}.`);
          }
        }

        const mb = (n: number) => (n / 1048576).toFixed(2);
        const total = all.reduce((sum, p) => sum + statSync(p).size, 0);
        const arcgisGz = arcgisFiles.reduce((sum, n) => sum + gz(n), 0);
        console.log(
          `check-dist: dist ${mb(total)} MB raw in ${all.length} files; ${arcgisFiles.length} ArcGIS ` +
            `chunks (${mb(arcgisGz)} MB gzipped, largest ${biggest ? mb(biggest[1]) : 0} MB); ` +
            `adapter static graph ${mb(adapterStatic)} MB; first-load graph ${firstLoad.size} ` +
            `file(s), no ArcGIS chunk.`,
        );
        if (problems.length) {
          throw new Error(`check-dist FAILED:\n- ${problems.join('\n- ')}`);
        }
        console.log('check-dist: OK');
      },
    },
  };
}
