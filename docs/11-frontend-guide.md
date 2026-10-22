# 11 · Frontend guide

## Data display rules (most important)
1. **Show exactly what the API returns.** Never calculate a status, threshold, alarm or colour from values. Colours come only from `status.display` (asset) or `state` (project).
2. **Render parameters generically.** Loop over `latestValues` (from `GET /assets/{id}`; lists and live messages don't carry values) using the display name and unit that come with each value. They are per source type (ADR 0011): the same key can have a different name on a DG and on a solar inverter, so never look a name up by key alone or reuse one asset type's name for another. If there is no entry, show the raw key and no unit. In the explorer, label each series with its own asset's name for the key. Never write a hard-coded list of parameters, except as an optional "pinned first" order from config.
3. **Always show freshness.** Every live value or box shows "updated hh:mm" (Asia/Dubai). Values with `stale: true` from the API show as stale (greyed, with a clock icon). The frontend never works out staleness itself. An asset the API flags as offline (no packet for 24 h, ADR 0013) shows the text "Offline" with its last packet time, next to its DATOMS status, never instead of it: it is a data-freshness label, not a status, and never changes a colour or a count. "No data" is shown as "—", never as 0. A field the DATOMS bulk response doesn't carry yet (`null` from the API) shows "no data yet" (ADR 0010).
4. **Never colour alone.** Status always shows text or an icon next to the colour (accessibility).
5. **Units and numbers.** Format with `Intl.NumberFormat('en-AE')`. Keep the source precision up to 2 decimals for display. Use the unit from the API exactly as given.
6. **Label what Nexus observed.** The status timeline is labelled **"observed by Nexus"** (status changes seen in polls, accurate to about one poll interval; ADR 0007).
7. **Equipment only.** Equipment tables, counts and map markers show only what the API returns (`kind = 'physical'`). Site-level records appear only in the energy box and ribbon (ADR 0009).

## Status and state tokens (`styles/tokens.css`)
| Token | Use | Colour |
|---|---|---|
| `--state-active` | Project active | green |
| `--state-central-store` | Central store | blue |
| `--state-finished` | Finished | grey |
| `--state-in-bid` | In bid | yellow / light green |
| `--status-running` | Running | green |
| `--status-idle` | Idle | amber |
| `--status-maintenance` | Maintenance | red |
| `--status-off` | Off | grey |
| `--status-unknown` | Unknown or unmapped | neutral outline |
Check contrast in both light and dark themes (WCAG AA).

**Project states are a fixed Nexus list (decided by Ahmed, 2026-10-22).** `active`, `central_store`, `finished` and `in_bid` (plus `unknown`) are Innovo's own project states from the structure sheet, not DATOMS data. They live in one place on each side: the `CHECK` list on `core.project.state` (`db/schema.sql`) and `PROJECT_STATE_KEYS` in `apps/api/src/modules/config/client-config.ts`, which a test compares with the database. The web reads the keys and labels from `GET /v1/config` (`enums.projectStates`) and never types them itself. Adding a state is a migration plus that constant. Asset statuses are different: they come from DATOMS through `telemetry.status_map` and are never a constant (hard rule 3).

## Innovo brand (S0-06, Brand Guidelines 1.9)
- **Palette** (all in `tokens.css` as `--brand-*`; the components page shows names and hex): primary Slate `#122023`, Aqua `#9EF3EE`, White `#FFFFFF`; secondary grey `#A2ACAB`, steel `#6F8695`, sky `#8BA8C8`; support (data only, never backgrounds or large text) `#FF6666`, `#157A6E`, `#91A6FF`, `#208AAE`, `#BAB1A0`, `#F5F2B8`.
- **Themes.** Light: near-white surfaces, Slate text, primary action and focus ring Slate. Dark: Slate surfaces, Aqua primary action and focus ring. `.surface-slate` re-scopes the tokens for a Slate panel in either theme (header, branded empty states).
- **Type:** Poppins 300/400/500/600, self-hosted by `@fontsource/poppins` (no CDN; CSP stays `'self'`), Calibri as fallback.
- **Logo:** `components/brand/InnovoLogo` (uses `currentColor`; white on Slate, Slate on white), files in `assets/brand/`. At least 80 px wide; clear space of one "i" height. Graphic device: `BrandRings` (Aqua rings and dot on Slate).
- **Header (decided by Ahmed, 2026-10-22):** the product name stays a **text wordmark** ("Nexus" set in text beside the Innovo logo; there is no separate Nexus logo artwork). The **"UAE" label is static text**, not a region switch or a data value.
- **State and status mapping** (names unchanged; the text label is always shown):

| Token | Light | Dark |
|---|---|---|
| active, running | teal `#157A6E` | aqua `#9EF3EE` |
| state-central-store | blue `#208AAE` | periwinkle `#91A6FF` |
| state-finished | steel `#6F8695` | sky `#8BA8C8` |
| state-in-bid | sand darkened `#857A5E` | sand `#BAB1A0` |
| status-idle | amber `#A15C00` (not in the palette; needed for AA) | yellow `#F5F2B8` |
| status-maintenance | red darkened `#D03E3E` | red `#FF6666` |
| status-off | grey `#75807F` | `#8497A3` |
| status-unknown | `#44585C` (hollow dot) | grey `#A2ACAB` |

Support colours are darkened in light where the original fails 3:1 on white. `--error` is a UI colour for errors, not a status.

**These colours are provisional (accepted by Ahmed, 2026-10-22).** Use them as they are. The darkened light-theme values above (added in PR #39 to pass WCAG AA) wait for confirmation by Innovo's brand owner (Q52). A change is a `tokens.css` edit only.

## Layout and responsiveness
- Breakpoints: `sm` 640 (phone), `md` 768 (tablet portrait), `lg` 1024 (tablet landscape / small laptop), `xl` 1280+.
- **Layout modes** (`app/layout/PageLayout`, S1-06): desktop from `xl` (1280), tablet from `md` to below `xl` (768–1279, so 1024 is tablet), phone below `md` (768).
- **Portfolio** (decided by Ahmed, 2026-10-14, following backlog S1-06 and PR #15; Q37 if the mockup shows otherwise):
  - Desktop: project list on the left, map in the centre, a details panel for the selected project on the right.
  - Tablet: the list collapses to a button that opens a drawer; the details panel stays on the right.
  - Phone: map and list are tabs, with a bottom sheet for the selected project.
- **Project page** (this section wins over the generic S1-06 shell; S4-04 builds it):
  - Desktop: map on the left (≈ 65%), info boxes in a right column.
  - Tablet: map on top, boxes in a 2-column grid below.
  - Phone: map (50 vh) with the boxes stacked, and the asset side panel as a bottom sheet.
- **Tables:** on a phone they become card lists with the key columns. Full tables appear from `md` up.
- Touch targets are at least 44 px. There is no hover-only information.

## States every screen must handle
`loading` (skeletons), `empty` ("No projects assigned to you"), `error` (retry, with the correlation id shown), `stale` (data delayed banner from `sync.status`), `forbidden` (should not happen; route guard), `coming later` (feature-flag slots).

## Live updates
- `LiveProvider` connects to Web PubSub after sign-in, then calls `POST /v1/live/subscriptions` with its `connectionId` to join `portfolio` and, while a project page is open, `project:{id}`. It calls `DELETE` when the user leaves. The client never joins groups itself (ADR 0008).
- Messages are slim (`10-api-design.md`). `asset.updated` (status and location only) patches the TanStack Query cache (`setQueryData`) and updates the map layer through `applyEdits`. `summary.updated` replaces the info box data. `values.updated` invalidates only the query of an open asset panel or device card, which then refetches `GET /assets/{id}`.
- If the server closes the connection (for example after an access change), the client reconnects and subscribes again. Projects no longer in scope are simply not joined.
- On disconnect it reconnects with backoff. While it is disconnected for more than 60 s, it falls back to `refetchInterval: 60_000`. `LIVE_MODE=poll` uses the same fallback all the time.

## Charts (ECharts)
- Time on the x-axis in Asia/Dubai. Show a band for min/max and a line for avg, which the rollups provide.
- Gaps stay gaps (`connectNulls: false`).
- **Data coverage:** show the coverage per bucket from `packets` / `expectedPackets` (for example a thin strip under the x-axis, with a tooltip of "n of m samples"). Buckets with low coverage are visibly marked, never hidden or filled (ADR 0007).
- Range picker: Day / Week / Month / Year / Custom. The server chooses the resolution and returns it. Show it, because a week older than 60 days comes back at 1 h, not 5 min.

## Code rules
- Data fetching only in `api/queries/*` hooks. Components never call `fetch` directly.
- The API types come only from the generated `api/schema.d.ts`.
- Permissions: `const { can } = usePermissions(); can('explorer.use')`, or `<Can permission="…">`.
- No `@arcgis/*` import outside `components/map/arcgis/`.
- Every feature folder has an `index.ts` that exports its routes. Features never import each other's internals.
- Tests: component tests for each info box and table, MSW for API responses, and Playwright for the main flows on desktop (1440×900) and phone (390×844).
