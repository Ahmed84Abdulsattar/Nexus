#!/usr/bin/env node
// S5-04 · Synthetic fleet generator for the worker load test (docs/12 section 3).
//
// Turns the recorded DATOMS fixtures into a synthetic fleet of N sites / M assets:
//   - asset list pages (DATOMS list shape, 1000 rows a page)
//   - bulk latest-value pages (DATOMS bulk shape, 500 rows a page, 60 s poll cadence)
//   - sites.json: site -> asset ids, for seeding Nexus projects and for the k6 ids file
//
// Only SHAPES are copied from the fixtures: category ids and names, the parameter keys per
// category, and numeric value ranges. Every id and name is synthetic (site-001, asset-00001);
// no serial numbers, coordinates or real asset names are carried over.
//
// Usage:
//   node tests/load/worker-5000-assets/generate.mjs [--sites 100] [--assets 5000]
//     [--fixtures packages/datoms-client/fixtures] [--out tests/load/worker-5000-assets/out]
//     [--seed 1] [--offline-share 0.05] [--polls 1] [--verify]
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');

const LIST_PAGE_SIZE = 1000; // docs/07: asset list limit
const BULK_PAGE_SIZE = 500; // docs/07: bulk page / id-mode limit

/** Small deterministic PRNG (mulberry32) so a run is repeatable from --seed. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n, w) => String(n).padStart(w, '0');

/** Builds per-category templates (weight, parameter keys, sample numeric values) from the fixtures. */
export function buildTemplates(assetList, bulk) {
  const byAsset = new Map(assetList.body.data.map((a) => [String(a.id), a]));
  const templates = new Map();
  for (const row of bulk.body.data) {
    const asset = byAsset.get(String(row.asset_id));
    if (!asset || !row.success || !row.data) continue;
    const key = asset.category_id;
    const t = templates.get(key) ?? {
      categoryId: asset.category_id,
      categoryName: asset.category_name,
      weight: 0,
      infoKeys: new Set(),
      params: row.data.parameters,
    };
    // Prefer the richest sample (most non-null parameters) as the template.
    const nonNull = (p) => Object.values(p).filter((v) => v !== null).length;
    if (nonNull(row.data.parameters) > nonNull(t.params)) t.params = row.data.parameters;
    for (const k of Object.keys(asset.asset_info ?? {})) t.infoKeys.add(k);
    templates.set(key, t);
  }
  // Weight by how often the category appears in the recorded asset list.
  for (const a of assetList.body.data) {
    const t = templates.get(a.category_id);
    if (t) t.weight += 1;
  }
  return [...templates.values()].filter((t) => t.weight > 0);
}

function pickWeighted(templates, rng) {
  const total = templates.reduce((s, t) => s + t.weight, 0);
  let r = rng() * total;
  for (const t of templates) {
    r -= t.weight;
    if (r <= 0) return t;
  }
  return templates[templates.length - 1];
}

const LAT_KEY = /^(lat|latitude)$/i;
const LONG_KEY = /^(long|lng|lon|longitude)$/i;

/** A fixed synthetic location per site, inside the UAE box (lat 22.6-26.1, long 51.6-56.4). */
export function siteLocation(siteIndex) {
  const step = siteIndex % 100;
  return {
    lat: Number((24 + step * 0.02).toFixed(4)),
    long: Number((54 + step * 0.02).toFixed(4)),
  };
}

/**
 * Jitters numeric parameters by +/-10% (nulls stay null, as DATOMS sends them).
 * Coordinate parameters are never derived from the recorded value: they get the site's fixed synthetic location.
 */
function jitter(params, rng, loc) {
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    if (LAT_KEY.test(k) || LONG_KEY.test(k)) {
      out[k] = v === null ? null : LAT_KEY.test(k) ? loc.lat : loc.long;
      continue;
    }
    out[k] = typeof v === 'number' && v !== 0 ? Number((v * (0.9 + rng() * 0.2)).toFixed(4)) : v;
  }
  return out;
}

export function generate({ sites, assets, assetList, bulk, seed, offlineShare, polls, now }) {
  const rng = makeRng(seed);
  const templates = buildTemplates(assetList, bulk);
  if (templates.length === 0) throw new Error('No usable category templates in the fixtures.');

  const fleet = [];
  const siteList = Array.from({ length: sites }, (_, i) => ({
    id: `site-${pad(i + 1, 3)}`,
    name: `Synthetic Site ${pad(i + 1, 3)}`,
    assetIds: [],
  }));
  for (let i = 0; i < assets; i++) {
    const tpl = pickWeighted(templates, rng);
    const id = `asset-${pad(i + 1, 5)}`;
    const site = siteList[i % sites];
    site.assetIds.push(id);
    const info = {};
    for (const k of tpl.infoKeys) info[k] = null; // keys only, no real values
    fleet.push({
      id,
      tpl,
      siteId: site.id,
      loc: siteLocation(i % sites),
      offline: rng() < offlineShare,
      listRow: {
        id,
        name: `${tpl.categoryName} ${id}`,
        created_at: '2026-01-01T00:00:00Z',
        lifecycle_status: 'active',
        category_id: tpl.categoryId,
        category_name: tpl.categoryName,
        asset_info: info,
      },
    });
  }

  const listPages = [];
  for (let i = 0; i < fleet.length; i += LIST_PAGE_SIZE) {
    listPages.push({
      success: true,
      status: 'success',
      data: fleet.slice(i, i + LIST_PAGE_SIZE).map((f) => f.listRow),
      pagination: {
        total: fleet.length,
        page: i / LIST_PAGE_SIZE + 1,
        limit: LIST_PAGE_SIZE,
        total_pages: Math.ceil(fleet.length / LIST_PAGE_SIZE),
      },
    });
  }

  // One entry per poll; each poll is a list of bulk pages. Poll n is n minutes after `now`.
  const bulkPolls = [];
  for (let p = 0; p < polls; p++) {
    const at = new Date(now.getTime() + p * 60_000);
    const rows = fleet.map((f) => {
      // Offline assets keep a packet from days ago, like the stale asset in the recorded fixture.
      const time = f.offline
        ? new Date(at.getTime() - 7 * 86_400_000).toISOString()
        : new Date(at.getTime() - Math.floor(rng() * 50_000)).toISOString();
      return {
        asset_id: f.id,
        success: true,
        data: { time, parameters: jitter(f.tpl.params, rng, f.loc) },
      };
    });
    const pages = [];
    for (let i = 0; i < rows.length; i += BULK_PAGE_SIZE) {
      pages.push({ success: true, status: 'success', data: rows.slice(i, i + BULK_PAGE_SIZE) });
    }
    bulkPolls.push(pages);
  }

  return {
    sites: siteList,
    listPages,
    bulkPolls,
    categories: templates.map((t) => ({
      id: t.categoryId,
      name: t.categoryName,
      weight: t.weight,
    })),
  };
}

/** Sanity checks used by --verify and by anyone wiring this into a test. */
export function verify(result, { sites, assets }) {
  const problems = [];
  const ids = result.listPages.flatMap((p) => p.data.map((a) => a.id));
  if (ids.length !== assets) problems.push(`expected ${assets} assets, got ${ids.length}`);
  if (new Set(ids).size !== ids.length) problems.push('duplicate asset ids');
  if (result.sites.length !== sites) problems.push(`expected ${sites} sites`);
  if (!ids.every((id) => /^asset-\d{5}$/.test(id))) problems.push('non-synthetic asset id');
  for (const poll of result.bulkPolls) {
    const rows = poll.flatMap((p) => p.data);
    if (rows.length !== assets)
      problems.push(`bulk poll has ${rows.length} rows, expected ${assets}`);
    if (poll.some((p) => p.data.length > BULK_PAGE_SIZE)) problems.push('bulk page over 500 rows');
  }
  return problems;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sites = Number(args.sites ?? 100);
  const assets = Number(args.assets ?? 5000);
  const seed = Number(args.seed ?? 1);
  const polls = Number(args.polls ?? 1);
  const offlineShare = Number(args['offline-share'] ?? 0.05);
  const fixturesDir = resolve(repoRoot, args.fixtures ?? 'packages/datoms-client/fixtures');
  const outDir = resolve(repoRoot, args.out ?? 'tests/load/worker-5000-assets/out');

  const listFile = join(fixturesDir, 'assets-list-page1.json');
  const bulkFile = join(fixturesDir, 'bulk-latest-id-mode.json');
  if (!existsSync(listFile) || !existsSync(bulkFile)) {
    console.error(
      `Fixtures not found in ${fixturesDir}.\n` +
        'They land on main with S2-02 (packages/datoms-client/fixtures/). Until then pass --fixtures <dir>.',
    );
    process.exit(2);
  }
  const assetList = JSON.parse(readFileSync(listFile, 'utf8'));
  const bulk = JSON.parse(readFileSync(bulkFile, 'utf8'));

  const result = generate({
    sites,
    assets,
    assetList,
    bulk,
    seed,
    offlineShare,
    polls,
    now: new Date(args.now ?? '2026-01-01T00:00:00Z'),
  });
  const problems = verify(result, { sites, assets });
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  if (args.verify) {
    console.log(`ok: ${sites} sites, ${assets} assets, ${polls} poll(s), seed ${seed}`);
    return;
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, 'assets-list'), { recursive: true });
  mkdirSync(join(outDir, 'bulk-latest'), { recursive: true });
  const write = (file, data) => writeFileSync(file, `${JSON.stringify(data)}\n`);
  write(join(outDir, 'sites.json'), result.sites);
  write(join(outDir, 'categories.json'), result.categories);
  result.listPages.forEach((p, i) =>
    write(join(outDir, 'assets-list', `page-${pad(i + 1, 3)}.json`), p),
  );
  result.bulkPolls.forEach((pages, n) =>
    pages.forEach((p, i) =>
      write(join(outDir, 'bulk-latest', `poll-${pad(n + 1, 3)}-page-${pad(i + 1, 3)}.json`), p),
    ),
  );
  // The k6 ids file: projectIds are the synthetic site ids; use it as K6_IDS_FILE.
  write(join(outDir, 'k6-ids.json'), {
    projectIds: result.sites.map((s) => s.id),
    assetIds: result.sites.flatMap((s) => s.assetIds),
  });
  console.log(`wrote ${sites} sites / ${assets} assets to ${outDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
