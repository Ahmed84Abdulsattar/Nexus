# 0011 · Parameter dictionary per source asset type

- **Status:** accepted
- **Date:** 2026-10-12
- **Deciders:** Ahmed (with the architect agent), after the DATOMS parameter list of 12 Oct 2026

## Context
- On 12 Oct 2026 DATOMS sent the parameter list for four asset categories with the provisional test key: DG Set (103 parameters), Fuel Tank (4), AC Sub-Meter (34) and Solar Inverter (23). The copy is `docs/source/datoms-parameters.md` (the source file is `datoms-parameters.xlsx`).
- **31 keys appear in more than one category, and the display name changes with the category.** For example, `mpow_r` is "Mains L1 Active Power" on a DG Set, "L1 Active Power" on an AC Sub-Meter and "AC  L1 Active Power" on a Solar Inverter. `fuel_consumption` is "Fuel Consumption" on a DG Set and "Fuel Consumption (Dispensed)" on a Fuel Tank. Units can differ in spelling too (`mr_energy`: kVARh vs kVArh). The full list is the table at the end of the markdown copy.
- Until now `telemetry.parameter` was unique on `(source_system, key)`, so one key had one display name and one unit. With this list, that would show a solar inverter's current as "Mains Current Phase1 (R)", which breaks hard rule 1 (show data as DATOMS reports it).
- Nexus already has two type notions:
  - `core.asset.source_type_name`: the asset's type exactly as the source names it.
  - `core.asset_type`: Nexus's own classification (icon, category for Box 2 vs Box 3, poll interval). `asset_type.source_names` maps source names to it. New source names start as `generic` until an admin maps them (`07` §6).
- `telemetry.parameter.category` already exists and means the parameter group as reported (for example "electrical"), not the asset category. A new column must not reuse that word.
- The exact category strings the API returns are not confirmed yet (Q35). The list gives "DG Set", "Fuel Tank", "AC Sub-Meter" and "Solar Inverter" (the sheet's DG tab is named "DG Set (18)", where "(18)" is very likely the count of DG sets, not part of the name). S2-02 records the real values from the Asset List.

## Decision
**`telemetry.parameter` is keyed by `(source_system, source_type_name, key)`.** `source_type_name` is the asset category **exactly as the source names it**, the same string that `core.asset.source_type_name` holds for the assets that report the key. Display name and unit are stored per row, so the same key can carry different names and units per category.

Details:
- Column `source_type_name text` (nullable), with `UNIQUE NULLS NOT DISTINCT (source_system, source_type_name, key)` (PostgreSQL 15+). `NULL` means the reporting asset's source type is not known yet (field names pending, Q22). Such rows hold the key only; they never borrow a name or unit from another type.
- **Lookup rule (API):** names and units for an asset's values come from the row where `parameter.source_system = asset.source_system AND parameter.source_type_name IS NOT DISTINCT FROM asset.source_type_name AND parameter.key = <value key>`. If there is no row, or the row has no display name, the API returns the raw key and no unit (`11` rule 2). **Never fall back to the same key from another source type.**
- **Write rule (worker):** the live poll inserts a row for each new `(source_system, asset.source_type_name, key)` it sees, insert-only as before. Display name and unit are filled from the source when it provides them; the source wins over anything an admin entered.
- **Seed:** `db/seeds/datoms-parameters.sql` loads the 164 rows of the 12 Oct 2026 list exactly as given (blank units stay `NULL`). It is source data delivered outside the API, not Nexus reference data, so it is a seed, not part of `db/schema.sql` or a migration. It runs in every environment and is idempotent. `data_type` stays at the column default in seeded rows, because the list gives no types (Q22). The live poll sets it once, from the JSON type of the first value it sees for that row; it is never guessed from the name or unit.
- **Category → Nexus type mapping is data:** the same seed appends the DATOMS category names to `core.asset_type.source_names`:

  | DATOMS category (as in the list) | `core.asset_type.code` | `category` |
  |---|---|---|
  | DG Set | `diesel_generator` | energy |
  | Fuel Tank | `fuel_tank` (new type) | energy |
  | AC Sub-Meter | `mains` | energy |
  | Solar Inverter | `solar` | energy |

  The mapping was given by Ahmed on 12 Oct 2026. `fuel_tank` is added to the `core.asset_type` reference rows in `db/schema.sql`.
- `telemetry.asset_parameter` is unchanged. Its `parameter_id` now points at the row for the asset's own source type.
- Rollups, packets and `latest_packet` are unchanged: they are per asset and store keys as reported.

### Why the raw source type name, and not an FK to `core.asset_type`
- **Hard rule 1 and 3.** Names and units are the source's words, so they are keyed by the source's own identity, read from data. `core.asset_type` is a Nexus classification that an admin can change. Keying the dictionary on it would make a source name depend on a Nexus mapping.
- **Many-to-one mappings collide.** Several source categories can map to one Nexus type (for example a second meter category mapped to `mains`), and every unmapped category is `generic` until an admin acts. With an FK to `asset_type`, two categories with different names for the same key would fight over one row.
- **Remapping stays cheap.** An admin changing which Nexus type a source category maps to (icon, Box 2 vs Box 3) does not touch the dictionary.
- **Rule 8 (source identity).** Each dictionary row is identified only by source values (`source_system`, `source_type_name`, `key`), like `source_system` + `external_id` on other synced rows. Nothing is deleted; unused rows simply stop being referenced.
- **The join already exists:** every asset carries `source_system` and `source_type_name`.

## Options considered
| Option | Pros | Cons |
|---|---|---|
| Key by `(source_system, source_type_name, key)`, raw source string (chosen) | Source words keyed by source identity; independent of Nexus type mapping; no new table | String key with no FK: a renamed DATOMS category would start a new set of rows (same risk as Q11 for ids); needs the exact category string (Q35) |
| Key by `(source_system, asset_type_id, key)`, FK to `core.asset_type` | Referential integrity; short join | Collides when several source categories map to one Nexus type or to `generic`; an admin remap changes display names; mixes Nexus classification with source data |
| New table `core.source_asset_type (source_system, external_id, name, asset_type_id)` and an FK from `parameter` | Strongest source identity (would hold a DATOMS category id if there is one) | Duplicates `asset_type.source_names`; we do not know yet whether DATOMS exposes a category id (the Asset List in S2-02 will show it). Can be added later if it does. |
| Keep one row per key; store per-category names in a jsonb column | No key change | Lookup logic in every query; units per category still awkward; hides the real identity |

## Consequences
- `db/schema.sql`: `telemetry.parameter` gets `source_type_name` and the new unique constraint; `core.asset_type` gets the `fuel_tank` row. No view joins `telemetry.parameter`, so no view changes. `db/roles.sql` is unchanged (the API still updates display columns only).
- `06` §3 and §4, `07` §3 to §5, `10` (`GET /parameters`, `GET /assets/{id}`), `11` rule 2 and the `14` review checklist describe the per-type lookup.
- The explorer may chart one key from assets of different types; each series is labelled with its own asset's name for the key.
- **Watch:** Q35 (the exact category strings). If the API names a category differently from the list (for example "DG set" or "Diesel Generator"), the seeded rows simply do not match: values show raw keys, never wrong names. The fix is a change to the seed file only.
- **To reverse:** collapse rows to one per key in a migration (choosing one name per key), and drop the column. Not expected: the list proves names differ per category.
