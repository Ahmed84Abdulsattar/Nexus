# Load tests (S5-04)

Two parts, as planned in `docs/12-scalability.md` section 3 and `docs/05-file-structure.md`.

| Part                             | Path                                         | Status                                                                                           |
| -------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| API, 1,000 users                 | `tests/load/api-1000-users.js` (k6)          | Runs today against `/health/live`. The `/v1` endpoints are listed but disabled until they exist. |
| Worker, 100 sites / 5,000 assets | `tests/load/worker-5000-assets/generate.mjs` | The fleet generator is built. Wiring it into the worker waits for the live poll (S3-03).         |

Backlog S8-01 re-runs these at 100+ sites and 1,000 users against dev.

## Install k6

Windows without admin rights: download the zip from <https://github.com/grafana/k6/releases> (`k6-vX.Y.Z-windows-amd64.zip`), unzip it anywhere and run `k6.exe` from there (or add that folder to your user PATH). With rights: `winget install k6 --source winget`.

Linux: Debian/Ubuntu follow <https://grafana.com/docs/k6/latest/set-up/install-k6/> (apt repository), or unzip the `linux-amd64.tar.gz` release into `~/bin`.

## API script

```
K6_API_BASE_URL=http://localhost:3000 \
K6_BEARER_TOKEN=<token> \
k6 run tests/load/api-1000-users.js
```

Environment (nothing is hard-coded; no secret goes in the repo or in shell history files):

| Variable                                   | Meaning                                                                                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `K6_API_BASE_URL`                          | API origin, default `http://localhost:3000`. Point it at dev for S8-01.                                                                                                               |
| `K6_BEARER_TOKEN`                          | Entra access token. Not needed for `/health/*`. `AUTH_MODE=dev` is not implemented in `apps/api` yet (it refuses to start), so until it is, take a real token for a test user in dev. |
| `K6_IDS_FILE`                              | JSON `{ "projectIds": [], "assetIds": [] }`, used when the list endpoints are disabled.                                                                                               |
| `K6_ENABLE`                                | `name1,name2` or `all`: enable endpoints that are disabled in the script.                                                                                                             |
| `K6_PEAK_VUS`, `K6_RAMP`, `K6_HOLD`        | Default 1000, 5m, 10m. Use small values for a smoke run.                                                                                                                              |
| `K6_THINK_MIN`, `K6_THINK_MAX`             | Seconds between journey steps, default 3 and 8.                                                                                                                                       |
| `K6_ENERGY_METRIC`, `K6_HISTORY_PARAMETER` | Metric and parameter keys for the trend calls (read them from `GET /parameters`).                                                                                                     |

Smoke run (what was recorded below):

```
K6_PEAK_VUS=50 K6_RAMP=10s K6_HOLD=30s K6_RAMPDOWN=5s K6_THINK_MIN=0.5 K6_THINK_MAX=1 k6 run tests/load/api-1000-users.js
```

### What it does

Each virtual user walks the docs/10 journey: portfolio (list, summary), search, project page (project, equipment summary, energy summary), equipment table, asset panel, energy page, 30-day trends, with think time between steps. Requests of one step are sent together, like a page load. The ids come from the project list (`GET /v1/projects`) when that endpoint is enabled, else from `K6_IDS_FILE`.

### Endpoints and how to enable them

The `ENDPOINTS` table at the top of the script lists every call from docs/10. When an endpoint lands, set `enabled: true` for it in the same PR as the endpoint. Check the response shape assumption in `setup()` (a bare array, or `items` / `data`).

### Thresholds

The run fails if a threshold is crossed. Each request is tagged with a `kind`:

| Kind                                                            | p95          | Source                                  |
| --------------------------------------------------------------- | ------------ | --------------------------------------- |
| `latest` (latest-value screens, summaries, asset panel, health) | under 300 ms | `docs/02` N-04                          |
| `search`                                                        | under 300 ms | N-04 (treated as a latest-value screen) |
| `page` (project list, equipment table)                          | under 2 s    | backlog S8-01                           |
| `chart` (30-day trends)                                         | under 1 s    | N-04, backlog S4 acceptance             |

Also `http_req_failed` under 1% and checks over 99%.

A threshold on a kind with no requests would pass silently, so for every enabled kind the script also requires `http_reqs{kind:X}` count above 0. If a call is skipped because its project id, asset id, `K6_HISTORY_PARAMETER` or `K6_ENERGY_METRIC` is missing, `setup()` prints a `WARNING` line and, if that was the whole kind, the run fails.

### Proof of independence (docs/12)

During the full run, the worker's DATOMS calls per minute must not change. Read the budget use in `GET /admin/integrations/health` (or the `sync_run` table) before and during the run, and record both.

## Worker fleet generator

```
node tests/load/worker-5000-assets/generate.mjs --sites 100 --assets 5000 --polls 2
node tests/load/worker-5000-assets/generate.mjs --sites 500 --assets 20000 --verify
```

**Generator tests** (no fixtures or network needed): `node --test "tests/load/worker-5000-assets/*.test.mjs"` (the quoted glob form works on Node 22 and 24; passing the bare directory fails on Node 24)

Options: `--fixtures <dir>` (default `packages/datoms-client/fixtures`, which arrives on main with S2-02; the script needs `assets-list-page1.json` and `bulk-latest-id-mode.json`), `--out <dir>` (default `tests/load/worker-5000-assets/out`, git-ignored), `--seed`, `--offline-share` (default 0.05, assets with a packet 7 days old), `--polls` (number of 60 s polls to generate), `--now`.

Output: `sites.json`, `categories.json`, `assets-list/page-NNN.json` (1,000 rows a page), `bulk-latest/poll-NNN-page-NNN.json` (500 rows a page), and `k6-ids.json`.

Only shapes are taken from the fixtures (category ids and names, parameter keys, numeric ranges, jittered by 10%). Ids and names are synthetic (`site-001`, `asset-00001`); serials and real asset names are not copied. Coordinate parameters (`lat`, `long`) are replaced by a fixed synthetic location per site inside the UAE box (or stay null where DATOMS sent null); nothing is derived from the recorded coordinate.

`k6-ids.json` holds the synthetic site ids. They only work as project ids if the database was seeded with those ids; otherwise leave `K6_IDS_FILE` unset and let the script read ids from the API.

### Next step (not built, needs S3-03)

Feed the pages to the worker through the fixture-replay mode of `datoms-client` (the same path `pnpm --filter @nexus/worker dev` uses without `DATOMS_LIVE=true`), seed 100 sites and 5,000 assets from `sites.json` and `assets-list/`, and time the poll plus writes (target under 30 s), the 5-minute bucket refresh (30 s), the hourly close (5 min) and the daily close (15 min). The page envelope for the bulk page mode must be matched to the recorded shape in the S2-02 client when this is wired.

## Recording results

Add a row to the table in `docs/12-scalability.md` section 3 ("Load test results") for every run: date, git commit, environment, script and settings, peak VUs, p95 per kind, errors, and pass or fail. Keep the k6 summary (`--summary-export results.json`) with the PR or the release notes, not in the repo.

## First run (2026-10-14, local, smoke)

Local API (`node apps/api/dist/main.js`, `APP_ENV=local`, placeholder Entra ids), k6 v2.3.0 for Windows from the zip (no admin rights), 50 VUs, 10 s ramp, 30 s hold, only `/health/live` enabled: 642 requests, 0 failed, 100% checks, p95 21 ms (threshold 300 ms), all thresholds passed. This proves the harness runs; it says nothing about the data endpoints.
