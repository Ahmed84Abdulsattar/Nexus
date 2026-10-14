// S5-04 QA · Checks for the fleet generator. Run: node --test tests/load/worker-5000-assets/
// Uses tiny inline fixtures (same shape as the recorded ones), so it needs no DATOMS data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, verify } from './generate.mjs';

const REAL_NAME = 'REAL-SITE-NAME-DO-NOT-COPY';
const REAL_SERIAL = 'SN-REAL-0001';

const assetList = {
  body: {
    data: [
      {
        id: 111,
        name: REAL_NAME,
        category_id: 7,
        category_name: 'DG Set',
        asset_info: { sl_no: REAL_SERIAL, kva: '500' },
      },
      {
        id: 222,
        name: 'Another real name',
        category_id: 7,
        category_name: 'DG Set',
        asset_info: { sl_no: 'SN-REAL-0002' },
      },
      {
        id: 333,
        name: 'Tank real',
        category_id: 9,
        category_name: 'Fuel Tank',
        asset_info: { capacity: '9000' },
      },
    ],
  },
};
const bulk = {
  body: {
    data: [
      {
        asset_id: 111,
        success: true,
        data: { time: '2026-01-01T00:00:00Z', parameters: { kw: 100, lat: 25.0774, off: null } },
      },
      {
        asset_id: 222,
        success: true,
        data: { time: '2026-01-01T00:00:00Z', parameters: { kw: 50, off: null } },
      },
      {
        asset_id: 333,
        success: true,
        data: { time: '2026-01-01T00:00:00Z', parameters: { level: 40 } },
      },
    ],
  },
};
const base = {
  assetList,
  bulk,
  seed: 1,
  offlineShare: 0.05,
  polls: 2,
  now: new Date('2026-01-01T00:00:00Z'),
};

test('default size: 100 sites / 5,000 assets, verify finds no problem', () => {
  const r = generate({ ...base, sites: 100, assets: 5000 });
  assert.deepEqual(verify(r, { sites: 100, assets: 5000 }), []);
  assert.equal(r.listPages.length, 5); // 1,000 rows a page
  assert.equal(r.bulkPolls.length, 2);
  assert.equal(r.bulkPolls[0].length, 10); // 500 rows a page
});

test('upper size: 500 sites / 20,000 assets', () => {
  const r = generate({ ...base, sites: 500, assets: 20000, polls: 1 });
  assert.deepEqual(verify(r, { sites: 500, assets: 20000 }), []);
  assert.equal(r.listPages.length, 20);
  assert.equal(r.bulkPolls[0].length, 40);
});

test('same seed gives the same output; another seed differs', () => {
  const a = JSON.stringify(generate({ ...base, sites: 10, assets: 200 }));
  assert.equal(a, JSON.stringify(generate({ ...base, sites: 10, assets: 200 })));
  assert.notEqual(a, JSON.stringify(generate({ ...base, seed: 2, sites: 10, assets: 200 })));
});

test('output carries only synthetic ids and names, no fixture string or id', () => {
  const out = JSON.stringify(generate({ ...base, sites: 10, assets: 200 }));
  for (const forbidden of [
    REAL_NAME,
    REAL_SERIAL,
    'SN-REAL-0002',
    'Another real name',
    'Tank real',
    '"500"',
    '"9000"',
    '25.0774',
  ]) {
    assert.ok(!out.includes(forbidden), `output contains ${forbidden}`);
  }
  for (const id of ['111', '222', '333'])
    assert.ok(!out.includes(`"id":"${id}"`) && !out.includes(`"asset_id":"${id}"`));
  const r = generate({ ...base, sites: 10, assets: 200 });
  for (const s of r.sites) assert.match(s.id, /^site-\d{3}$/);
  for (const p of r.listPages) for (const a of p.data) assert.match(a.id, /^asset-\d{5}$/);
  // asset_info keeps keys only, never values
  for (const p of r.listPages)
    for (const a of p.data) assert.ok(Object.values(a.asset_info).every((v) => v === null));
});

test('null parameters stay null (missing data is never turned into a number)', () => {
  const r = generate({ ...base, sites: 5, assets: 100 });
  const rows = r.bulkPolls[0].flatMap((p) => p.data);
  assert.ok(
    rows.every((row) =>
      Object.values(row.data.parameters).every((v) => v === null || typeof v === 'number'),
    ),
  );
  assert.ok(rows.some((row) => Object.values(row.data.parameters).includes(null)));
});

test('about offlineShare of assets have a packet 7 days old', () => {
  const r = generate({ ...base, sites: 10, assets: 5000, offlineShare: 0.05, polls: 1 });
  const rows = r.bulkPolls[0].flatMap((p) => p.data);
  const old = rows.filter(
    (x) => Date.parse(x.data.time) < base.now.getTime() - 6 * 86400000,
  ).length;
  assert.ok(old > 150 && old < 350, `offline count ${old} not near 250`);
});

test('verify reports wrong counts and duplicate ids', () => {
  const r = generate({ ...base, sites: 10, assets: 100 });
  assert.ok(verify(r, { sites: 10, assets: 101 }).length > 0);
  assert.ok(verify(r, { sites: 11, assets: 100 }).length > 0);
});
