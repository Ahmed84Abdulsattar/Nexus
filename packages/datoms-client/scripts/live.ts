// Live DATOMS CLI. Refuses to run unless DATOMS_LIVE=true (set on the command line only, never
// in a file). This is the ONLY place `GET /assets/{id}/data/latest` is called (ADR 0010).
//
//   DATOMS_LIVE=true pnpm --filter @nexus/datoms-client live -- --env-file <path-to-.env> <command>
//
// Commands:
//   list                 GET /assets, at most 5 pages (limit 60 per 60 s per IP)
//   latest <id>...       exactly ONE data/latest call per id (limit 8 per 5 min per asset)
//   bulk <id>...         exactly ONE bulk call, id mode, 1 to 10 ids; add --fleet for fleet mode
//                        (page 1, limit 500; spends credits, use sparingly)
//
// `pnpm live` compiles src/ and scripts/ first (tsc, no new dependency), then runs this file.
import { DatomsClient, assertLive, loadDatomsConfig, type DatomsResponse } from '../src/index.js';
import { DatomsHttp } from '../src/http.js';
import {
  MAX_BULK_IDS,
  MAX_LATEST_IDS,
  latestPath,
  loadEnvFileKeepingLiveGate,
  validateIds,
} from './guards.js';
import { saveFixture } from './record.js';

const argv = process.argv.slice(2);
const envIdx = argv.indexOf('--env-file');
if (envIdx >= 0) {
  const path = argv[envIdx + 1];
  if (!path) throw new Error('--env-file needs a path');
  loadEnvFileKeepingLiveGate(path); // nothing is printed; the file cannot turn DATOMS_LIVE on
  argv.splice(envIdx, 2);
}
const fleet = argv.includes('--fleet');
const rest = argv.filter((a) => a !== '--fleet' && a !== '--');
const [cmd, ...args] = rest;
const config = loadDatomsConfig();
assertLive(config);
const client = new DatomsClient(config);
const http = new DatomsHttp(config, undefined, undefined, { allowPerAssetLatest: true });

interface LatestBody {
  data: { time: string; parameters: Record<string, unknown> };
}

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
    saveFixture(
      `assets-list-page${page}.json`,
      'GET',
      `/assets?page=${page}&limit=1000`,
      res,
      config.token,
    );
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
  for (const id of validateIds(args, MAX_LATEST_IDS)) {
    const path = latestPath(id); // validated and URL-encoded
    const res = await http.request<LatestBody>('GET', path);
    show(`GET ${path}`, res);
    saveFixture(`asset-latest-${id}.json`, 'GET', path, res, config.token);
    if (res.ok && res.body) {
      console.log(
        `  time=${res.body.data.time} keys=${Object.keys(res.body.data.parameters).length}`,
      );
    }
  }
} else if (cmd === 'bulk') {
  const ids = fleet ? [] : validateIds(args, MAX_BULK_IDS);
  // One call, no retry, no loop.
  const res = fleet ? await client.bulkLatestFleet(1, 500) : await client.bulkLatestById(ids);
  const mode = fleet ? 'fleet' : 'id';
  show(`POST /assets/telemetry/latest/query (${mode} mode)`, res);
  saveFixture(
    `bulk-latest-${mode}-mode.json`,
    'POST',
    '/assets/telemetry/latest/query',
    res,
    config.token,
  );
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
