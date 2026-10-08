# 11 · Frontend guide

## Data display rules (most important)
1. **Show exactly what the API returns.** Never calculate a status, threshold, alarm or colour from values. Colours come only from `status.display` (asset) or `state` (project).
2. **Render parameters generically.** Loop over `latestValues` using the `/parameters` dictionary for display name and unit. If the dictionary has no entry, show the raw key and no unit. Never write a hard-coded list of parameters, except as an optional "pinned first" order from config.
3. **Always show freshness.** Every live value or box shows "updated hh:mm" (Asia/Dubai). Values with `stale: true` from the API show as stale (greyed, with a clock icon). The frontend never works out staleness itself. "No data" is shown as "—", never as 0.
4. **Never colour alone.** Status always shows text or an icon next to the colour (accessibility).
5. **Units and numbers.** Format with `Intl.NumberFormat('en-AE')`. Keep the source precision up to 2 decimals for display. Use the unit from the API exactly as given.

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
- `LiveProvider` connects to Web PubSub after sign-in and joins `project:{id}` while a project page is open, plus `portfolio`.
- An `asset.updated` message patches the TanStack Query cache (`setQueryData`) and updates the map layer through `applyEdits`.
- On disconnect it reconnects with backoff. While it is disconnected for more than 60 s, it falls back to `refetchInterval: 60_000`.

## Charts (ECharts)
- Time on the x-axis in Asia/Dubai. Show a band for min/max and a line for avg, which the rollups provide.
- Gaps stay gaps (`connectNulls: false`).
- Range picker: Day / Week / Month / Year / Custom. The server chooses the resolution.

## Code rules
- Data fetching only in `api/queries/*` hooks. Components never call `fetch` directly.
- The API types come only from the generated `api/schema.d.ts`.
- Permissions: `const { can } = usePermissions(); can('explorer.use')`, or `<Can permission="…">`.
- No `@arcgis/*` import outside `components/map/arcgis/`.
- Every feature folder has an `index.ts` that exports its routes. Features never import each other's internals.
- Tests: component tests for each info box and table, MSW for API responses, and Playwright for the main flows on desktop (1440×900) and phone (390×844).
