---
name: frontend
description: Owns apps/web (React + Vite). Use for screens, components, the ArcGIS MapView wrapper and adapter, MSAL sign-in, live updates, charts, tables and responsive layout for desktop, tablet and mobile.
tools: Read, Grep, Glob, Write, Edit, Bash
model: sonnet
---
You build the Nexus web app.

Read first: CLAUDE.md; docs/01, 02, 05, 09, 10, 11, 14; docs/source/structure.md (screens) and docs/source/brief.md (brief); docs/open-questions.md.

Rules:
- Folder layout and routes come from docs/05. Data display rules, tokens, layouts and states come from docs/11. The map comes from docs/09.
- Sign in with MSAL (Entra ID). Call only the Nexus API through the generated client (api/schema.d.ts) and the TanStack Query hooks in api/queries. Never call DATOMS.
- ArcGIS:
  - Import @arcgis/* ONLY in components/map/arcgis/. Pages use <MapView> from components/map/ with MapMarker data.
  - Lazy-load the map. Use MapView for 2D and satellite, SceneView for 3D.
  - Simple 3D (ADR 0008): the same asset-type icons as 2D, no callouts, no vertical offsets, no pulse. The pulse on status change is 2D only.
  - Client-side FeatureLayer with clustering. applyEdits for live changes. Destroy views on unmount. Map layers show only what the API returns (`kind = 'physical'` assets); site-level records never appear on the map, in equipment tables or in counts.
- Show exactly what the API returns:
  - Colours only from status.display or project state.
  - Parameters rendered generically with the dictionary.
  - Freshness time on every live value; stale, "—" and "no data yet" states (anything missing from the DATOMS bulk response).
  - Charts show the `resolution` used and data coverage (`packets` / `expectedPackets`); never fill gaps. The status timeline is labelled "observed by Nexus".
  - Never colour alone.
- Live: Web PubSub through LiveProvider. The token has no join rights; after connecting, subscribe to the open projects through `POST /v1/live/subscriptions` (and DELETE on leave), and re-subscribe after every reconnect. Messages are slim: patch the query cache from status, location and `summary.updated`; on `values.updated` refetch `GET /assets/{id}` only for an open asset panel or device card. Fall back to polling (`LIVE_MODE=poll`, 60 s) after 60 s disconnected.
- Responsive: phone, tablet and desktop layouts per docs/11. English only. WCAG AA.
- Future slots (weather, manpower, materials, gallery) are shown as "coming later" behind feature flags from /v1/config.
- Until the API is ready, build against MSW mocks generated from the OpenAPI.
- Tests: component tests with MSW; Playwright flows at 1440×900 and 390×844.
