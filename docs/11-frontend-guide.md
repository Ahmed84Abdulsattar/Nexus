# 11 · Frontend guide

## Data display rules (most important)
1. **Show exactly what the API returns.** Never calculate a status, threshold, alarm or colour from values. Colours come only from `status.display` (asset) or `state` (project).
2. **Render parameters generically.** Loop over `latestValues` (from `GET /assets/{id}`; lists and live messages don't carry values) using the `/parameters` dictionary for display name and unit. If the dictionary has no entry, show the raw key and no unit. Never write a hard-coded list of parameters, except as an optional "pinned first" order from config.
3. **Always show freshness.** Every live value or box shows "updated hh:mm" (Asia/Dubai). Values with `stale: true` from the API show as stale (greyed, with a clock icon). The frontend never works out staleness itself. "No data" is shown as "—", never as 0. A field the DATOMS bulk response doesn't carry yet (`null` from the API) shows "no data yet" (ADR 0010).
4. **Never colour alone.** Status always shows text or an icon next to the colour (accessibility).
5. **Units and numbers.** Format with `Intl.NumberFormat('en-AE')`. Keep the source precision up to 2 decimals for display. Use the unit from the API exactly as given.
6. **Label what Nexus observed.** The status timeline is labelled **"observed by Nexus"** (status changes seen in polls, accurate to about one poll interval; ADR 0007).
7. **Equipment only.** Equipment tables, counts and map markers show only what the API returns (`kind = 'equipment'`). Site-level records appear only in the energy box and ribbon (ADR 0009).

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

## Layout and responsiveness
- Breakpoints: `sm` 640 (phone), `md` 768 (tablet portrait), `lg` 1024 (tablet landscape / small laptop), `xl` 1280+.
- **Portfolio:**
  - Desktop: map full screen, with the project list as a right side panel.
  - Tablet: the list is a collapsible drawer.
  - Phone: map and list are tabs, with a bottom sheet for the selected project.
- **Project page:**
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
