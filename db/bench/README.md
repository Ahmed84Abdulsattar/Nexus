# Database benchmark

These scripts reproduce the measurements in `docs/06-database.md` section 6. Run them on an empty database that already has `db/schema.sql` applied. Never run them on production.

```
for f in db/bench/0*.sql; do psql -d nexus_bench -f "$f"; done
```
Run `05-screen-queries.sql` twice: the first run gives cold timings, the second warm.

Data created:
- 100 projects and 5,000 assets.
- 300 assets with 1 day of 1-minute packets, 103 parameters each.
- Rollups: 5-minute for 8 days, hourly for 180 days, daily for 3 years.
- 1 M events.

You need about 10 GB of free disk. The full load takes about 6 minutes on 2 vCPU.
