// Live DATOMS CLI. Refuses to run unless DATOMS_LIVE=true (set on the command line only).
// Load secrets by path, never by printing them:
//   DATOMS_LIVE=true node --env-file=<path-to-.env> scripts/live.ts list
//   ... live.ts latest <assetId>      exactly ONE data/latest call per id (limit 8 per 5 min per asset)
//   ... live.ts bulk <id> [<id>...]   exactly ONE bulk call, id mode, at most 10 ids
// Needs a built package: `pnpm --filter @nexus/datoms-client build`.
import { DatomsClient, assertLive, loadDatomsConfig, type DatomsResponse } from '../dist/index.js';
import { saveFixture } from './record.ts';

const [cmd, ...args] = process.argv.slice(2);
const config = loadDatomsConfig();
assertLive(config);
const client = new DatomsClient(config);

function show(label: string, res: DatomsResponse): void {
  // Status, error code and rate-limit response headers only. Never request headers.
  console.log(
    `${label}: HTTP ${res.status} ${res.durationMs} ms`,
    res.error?.code ? `error=${res.error.code}` : '',
    JSON.stringify(res.rateLimit),
  );
}

if (cmd === 'list') {
  // At most 5 requests in total (limit: 60 per 60 s per IP).
  let page = 1;
  let totalPages = 1;
  const all: Record<string, unknown>[] = [];
  while (page <= totalPages && page <= 5) {
    const res = await client.listAssets(page, 1000);
    show(`GET /assets page ${page}`, res);
    saveFixture(`assets-list-page${page}.json`, 'GET', `/assets?page=${page}&limit=1000`, res);
    if (!res.ok || !res.body) break;
    totalPages = res.body.pagination.total_pages;
    console.log('pagination', JSON.stringify(res.body.pagination));
    all.push(...res.body.data);
    page++;
  }
  console.log('assets received', all.length);
  const keys = new Map<string, number>();
  for (const a of all) for (const k of Object.keys(a)) keys.set(k, (keys.get(k) ?? 0) + 1);
  console.log('asset fields', JSON.stringify([...keys.entries()]));
  // Low-cardinality string fields (candidates for the category), and nested objects one level down.
  const flat = (a: Record<string, unknown>): Record<string, unknown> => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(a)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) o[`${k}.${k2}`] = v2;
      } else o[k] = v;
    }
    return o;
  };
  const dist = new Map<string, Map<string, number>>();
  for (const a of all) {
    for (const [k, v] of Object.entries(flat(a))) {
      if (typeof v !== 'string') continue;
      const m = dist.get(k) ?? new Map<string, number>();
      m.set(v, (m.get(v) ?? 0) + 1);
      dist.set(k, m);
    }
  }
  for (const [k, m] of dist) {
    if (m.size <= 12 && m.size < all.length) {
      console.log(`distinct ${k}:`, JSON.stringify([...m.entries()]));
    } else {
      console.log(`distinct ${k}: ${m.size} values`);
    }
  }
} else if (cmd === 'latest') {
  for (const id of new Set(args)) {
    const res = await client.getLatestForAsset(id);
    show(`GET /assets/${id}/data/latest`, res);
    saveFixture(`asset-latest-${id}.json`, 'GET', `/assets/${id}/data/latest`, res);
    if (res.ok && res.body) {
      console.log(
        `  time=${res.body.data.time} keys=${Object.keys(res.body.data.parameters).length}`,
      );
    }
  }
} else if (cmd === 'bulk') {
  const ids = [...new Set(args)];
  if (ids.length < 1 || ids.length > 10) throw new Error('bulk: give 1 to 10 ids');
  const res = await client.bulkLatestById(ids); // one call, no retry, no loop
  show('POST /assets/telemetry/latest/query (id mode)', res);
  saveFixture('bulk-latest-id-mode.json', 'POST', '/assets/telemetry/latest/query', res);
  if (res.ok && res.body) {
    for (const r of res.body.data) {
      console.log(
        `  ${r.asset_id} success=${String(r.success)}`,
        r.data ? `time=${r.data.time} keys=${Object.keys(r.data.parameters).length}` : '',
      );
    }
  }
} else {
  console.log('usage: live.ts list | latest <id>... | bulk <id>...');
  process.exitCode = 1;
}
