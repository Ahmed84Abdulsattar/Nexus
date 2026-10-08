# 0002 · Esri ArcGIS as the map provider

- **Status:** accepted (replaces backlog task S0-09 "map provider decision")
- **Date:** 2026-10-07
- **Deciders:** Ahmed, frontend developer, Innovo Labs

## Context
- The structure sheet asks for a UAE portfolio map, plus a project map with a Satellite / 2D / 3D switch and asset icons coloured by status.
- BIM models are planned later.
- Options compared: Google Maps, Azure Maps, Esri ArcGIS.

## Decision
- Use the **ArcGIS Maps SDK for JavaScript** (`@arcgis/core`): MapView for 2D and satellite, SceneView for 3D.
- It is always used behind the `MapView` wrapper in `apps/web/src/components/map/`.
- Phase 1 auth is an API key restricted by referrer. If Innovo has an ArcGIS Online / Enterprise org, switch to org OAuth (open question for Innovo IT).

## Options considered
| Option | Pros | Cons |
|---|---|---|
| ArcGIS (chosen) | True 3D scenes with terrain and buildings; best BIM path (I3S Building Scene Layers, IFC/Revit); enterprise GIS; clustering | Larger SDK; licensing to manage; steeper learning curve |
| Google Maps | Familiar, great imagery | 3D limited for custom data; no BIM path; usage costs at scale |
| Azure Maps | Same cloud, simple pricing | Weak 3D; no BIM path |

## Consequences
- Lazy-load the map chunk, because it is heavy.
- BIM in phase 3 can stay in the same SceneView (preferred), or use an APS route if needed (new ADR).
- Map usage is measured in App Insights (view loads) to track the licence.
