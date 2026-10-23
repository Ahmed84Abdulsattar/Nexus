# 0013 · Stale and offline: data-freshness display rules

- **Status:** accepted (Ahmed, 2026-10-19 and 2026-10-22)
- **Date:** 2026-10-22
- **Deciders:** Ahmed, with the architect agent

## Context
- **Hard rule 1:** show data as DATOMS reports it. Never invent statuses, thresholds, alarms or calculated values. Missing data is "—" plus a timestamp.
- **R-27** asks that old data be visible, using DATOMS's own offline rule (Q8). DATOMS has not given one. Until now Nexus had only the interim setting `display.stale_after_seconds` (300 s, `db/schema.sql`) and no rule for an asset that stops reporting for days.
- **Cadence.** Most DATOMS assets report about every 60 s (45 to 90 s), four DG channels about every 80 s (`07` §3.3, 14 Oct 2026). Nexus polls every 60 s (ADR 0004; per type, ADR 0006). So a healthy value is at most about 2 minutes old on screen (N-03).
- **Three assets never update ("frozen"):** DG 42485 (last `data.time` 2026-10-05T04:28:45Z), DG 42484 (2026-09-19T02:00:55Z) and AC Sub-Meter 33851 (2026-09-20T09:15:10Z). The bulk endpoint still returns them with `success: true` and the same old `data.time`, so "reported" does not mean "fresh". Why they are frozen is Q49.
- **DATOMS now reports a `status` field** on the Asset List (Ahmed's CLI test, 21 Oct 2026; values seen: `connected`, `running`, `offline`, `stopped`; Q47). That is a DATOMS status. It is mapped in S3-03 and is not part of this ADR.

## Decision
Two thresholds decide how the **age of an asset's newest packet is displayed**. Both are settings in `core.setting`. They never create a status, an alarm, an event or a value.

| Label | When | Setting (default) |
|---|---|---|
| **Stale** | The newest packet Nexus stored for the asset (`telemetry.latest_packet.ts`, the DATOMS `data.time`) is older than 5 minutes | `display.stale_after_seconds` = `300` (already in the schema; its "INTERIM" description is updated) |
| **Offline** | No newer packet for 24 hours | `display.offline_after_seconds` = `86400` (new) |

Rules:
1. **Age** = now (UTC, server clock) − `ts` of the asset's newest stored packet. The API works it out when it reads. The worker writes nothing for it (no per-poll bookkeeping, `06` §4). The browser never works it out (`11` rule 3).
2. **Stale** when the age is greater than `display.stale_after_seconds`, but never less than twice the asset type's current poll interval (the ADR 0006 floor stays, so slow-polled types do not always look stale). At the 60 s default the 300 s value applies.
3. **Offline** when the age is greater than `display.offline_after_seconds`. An offline asset is also stale.
4. If a setting is missing or not a positive number, or offline is not greater than stale, the API uses the defaults above and logs a warning (the same pattern as the retention minimums, `06` §6a).
5. An asset with no packet at all is neither stale nor offline. It shows "no data yet" (`10`, ADR 0010).
6. Changing the values is a settings change (data). It needs no code change and no new ADR. If DATOMS gives its own offline rule (Q8) and it is a time limit, set the two values to match it.

### How this stays inside hard rule 1
- **The value shown is always the DATOMS value with its DATOMS time.** Stale greys it out (with the clock icon, `11` rule 3). It is never hidden, set to 0, replaced or extrapolated.
- **"Offline" is a data-freshness label, never a status.** It does not change `status_display`, a status or pin colour, the Box 2 or Box 3 counts (they follow the DATOMS status, R-24), or the status filters. It raises no event, notification or alert (R-40: Nexus raises none of its own). It is shown as text with the time of the last packet, for example "Offline · last data 5 Oct 08:28" (Asia/Dubai).
- The thresholds are about **how old the data is**, like a "last updated" time. They are never applied to a measured value.
- **The DATOMS status value `offline` is a different thing.** Once S3-03 maps the `status` field, it is shown as reported, through `telemetry.status_map`. The UI keeps the two apart: the status chip shows the DATOMS status; the freshness line shows Nexus's label with the time.

### Frozen assets
DG 42485, DG 42484 and AC Sub-Meter 33851 are stored and shown like any other asset: their last values greyed, with their old time and the "Offline" label. They are not hidden and not retired (retiring follows only the catalogue rule, `07` §6). Their old packet is not written again (change detection, `07` §4 item 6). Q49 asks DATOMS why they are frozen.

### Related decisions recorded here
- **Poll cadence.** The 60 s poll is accepted as the default (ADR 0004). The per-type override stays available (ADR 0006); every type is `null` (60 s) today. So "stale" is five poll intervals and "offline" is 1,440.
- **DG location (S3-03).** The DATOMS Asset List now gives `latitude` and `longitude` (21 Oct 2026). S3-03 writes the DG latitude and longitude to `telemetry.asset_location_current`:
  - The DATOMS field names stay in `packages/datoms-client/src/mapping.ts` only (hard rule 2).
  - The same mapping applies to any asset for which the Asset List gives both values. Nothing in code lists asset types (hard rule 3).
  - Written on change only, with `observed_at` = the time Nexus read the list (the list carries no location time), plus a `telemetry.asset_location_history` row when the position changes.
  - A missing or `null` value gives no location ("Not on map", `09` §4), never 0.
  - The DG Set parameters `lat` and `long` in the bulk rows stay ordinary parameters. They are not assumed to be the location (Q22).
- **DATOMS `status` field (S3-03).** S3-03 maps the Asset List `status` into `telemetry.asset_status_current` in `mapping.ts`. The display bucket comes from `telemetry.status_map`; a new label gets `unknown` plus a linking to-do until an admin maps it (`07` §6). This ADR changes no status rule.

## Options considered
| Option | Pros | Cons |
|---|---|---|
| **Two settings, stale 5 min and offline 24 h, as display labels only (chosen)** | Frozen assets are visible as old at a glance. Values follow DATOMS's answer (Q8) with no code change. No status is invented. | Two more labels for users to learn. The word "offline" is also a DATOMS status value (see Consequences). |
| Wait for DATOMS's rule (Q8); show only the "last updated" time | No Nexus rule at all | A frozen asset looks live for weeks unless the user reads the time. R-27 stays unmet. |
| A Nexus `offline` status (a new `display_status` bucket) | One field in the UI | Invents a status (hard rule 1). Changes colours and the Box 2 counts. |
| Hide or retire assets with no packet for N days | Cleaner screens | Hides DATOMS data. Retiring is a catalogue rule, not a freshness rule (hard rule 8, `07` §6). |

## Consequences
**To build (not in this docs PR)**
- **Settings migration.** A new migration (`0001_init.sql` is frozen) adds `display.offline_after_seconds` (`86400`) and removes "INTERIM" from the description of `display.stale_after_seconds`. `db/schema.sql` is updated in the same PR and `pnpm db:check` passes. It lands with the first PR that returns live values (planned: S4-03).
- **API field.** Proposed: an asset-level `offline: boolean` next to `lastPacketAt` wherever an asset's live data is returned (`GET /projects/{projectId}/assets`, `GET /assets/{assetId}`). The exact name is settled in that PR's OpenAPI. `docs/10` "Freshness" is updated in the same PR.
- **UI.** S7-07 shows the labels (rule 3 in `11`), and any earlier screen that shows live values uses the same component.
- **S3-03:** the location and status mapping above.

**To watch**
- The DATOMS status `offline` and the Nexus label "Offline" use the same word. The label always carries its time ("last data …"). If users confuse the two, change the label text in the UI only; the setting keeps its name.
- If DATOMS answers Q8 with a rule that is not a time limit (for example a field), map that field in `mapping.ts` and supersede this ADR.

**To reverse:** set `display.offline_after_seconds` very high (the label never appears), or supersede this ADR.

**Docs updated with this ADR:** `00-README.md` (ADR list), `02` R-27, `10` "Freshness", `11` rule 3, `open-questions.md` (Q8, Q49). `07` §3.3 (frozen assets), §5 (the catalogue writes location and status) and §6 are updated later, in a separate docs change.
