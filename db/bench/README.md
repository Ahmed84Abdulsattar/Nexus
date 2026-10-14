# Database benchmark

Reproduces the measurements in `docs/06-database.md` section 6. Run it after any change to a telemetry or event table and paste the timing table into the PR. **A query over its N-04 target blocks the merge** (the script exits with code 2).

```
createdb nexus_scale                       # a fresh database; the name must contain scale, bench or tmp
export APP_ENV=local DATABASE_ADMIN_URL=postgres://nexus@localhost:5432/nexus_scale
pnpm db:migrate
pnpm db:seed:scale                         # options: --packet-assets 300 --days 7 --history-days 90 --events 1000000
```

What `db/seeds/scale-100-sites.ts` loads: 100 projects, 5,000 assets (48 physical and 2 `site_metric` per project, about 60% placed in a zone), packets for a random sample of 300 physical assets for 7 days at 1 per minute, using the real DATOMS parameter keys of each category (DG Set 103, Fuel Tank 4, AC Sub-Meter 34, Solar Inverter 23), 5-minute/hourly/daily rollups made by the real SQL functions, synthetic older rollups (90 days hourly, 3 years daily), and 1,000,000 events. Values are random numbers, not DATOMS data; **re-run with recorded fixtures in S2/S3** before deciding on a compact rollup format (that needs an ADR).

`screens.ts` holds the main-screen queries of `docs/06` section 5 with their targets (live screens 300 ms, charts 1 s). Each is run once right after the load ("first") and five more times ("warm", median) with `EXPLAIN (ANALYZE)`. The first run is not a true cold-cache run (the load just touched the data); a real cold run needs a server restart.

Disk: about 10 to 15 GB for the default dataset. Takes 30 to 60 minutes on a laptop-class machine, mostly the packet generation and the bulk rollup backfill (the production rollups run once per closed bucket and are timed separately at the end). Never run it on a shared or production database.
