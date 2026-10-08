# 0009 · `core.asset.kind`: physical equipment vs site-level metrics

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** Ahmed (architecture review 1, concern 11)

## Context
- Some data belongs to a site rather than to a physical item. Examples are energy site totals (R-25, `07` §3) and, later, manpower counts and weather (`13-roadmap-future.md`).
- The plan was to store such data as a "site-level virtual asset" so that it reuses `telemetry.packet`, `latest_packet` and the parameter dictionary.
- Without a marker, such a row would be counted in Box 2 "Total equipment" (R-24 counts category `other`). It would also appear in the equipment table and in the map's "Not on map" list, and it would be offered in the explorer as if it were a device.

## Decision
Add `core.asset.kind text NOT NULL DEFAULT 'equipment' CHECK (kind IN ('equipment','site_metric'))`.
- `equipment` means a physical, sensored item of **any** category: equipment, energy, vehicle, environment or other. This includes DGs, solar and mains. `asset_type.category` still decides Box 2 vs Box 3.
- `site_metric` means a record that carries values for a whole site (project), as the source reports them.
- **Every equipment list, count, map layer and view filters `kind = 'equipment'`.** This covers `core.v_asset_live`, `core.v_project_asset_counts`, `/projects/{id}/assets`, `/projects/{id}/equipment/*`, the energy equipment table, map markers and "Not on map".
- Site-level values are read through a separate view, `core.v_site_metric_live`, used by the energy summary (R-25) and, later, by manpower and weather.
- The connector sets `kind` from the source data. The rule that recognises a DATOMS site-level row lives only in `packages/datoms-client/src/mapping.ts`. It waits for the DATOMS sample and field list (Q21, Q22). Nexus never invents a site total.

## Options considered
| Option | Pros | Cons |
|---|---|---|
| `kind` column on `core.asset` (chosen) | Reuses packets, latest values, rollups and the parameter dictionary; one filter | Every asset query must remember the filter (enforced in views, the review checklist and tests) |
| A separate `telemetry.project_metric` table | Clean separation | Duplicates the packet, latest and rollup machinery for each new site-level source |
| No marker | Nothing to do | Wrong counts in Box 2 and polluted equipment screens |

## Consequences
- The `14-testing-quality.md` review checklist gets "equipment queries filter `kind = 'equipment'`".
- Future site-level sources (manpower, weather) need no schema change: they write `site_metric` assets.
- 5-minute and hourly rollups are still computed for `site_metric` rows. For daily-count sources they are not meaningful, and the screens for those sources read `latest_packet` or `rollup_1d` instead. This is decided when those modules are built.
- To reverse: drop the column and views in a migration. No `site_metric` rows exist until DATOMS provides site-level data.
