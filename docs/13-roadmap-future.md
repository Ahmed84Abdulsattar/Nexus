# 13 · Roadmap and future plan

Agents: **do not build anything in this file during phase 1.** Read it so that phase 1 code never blocks it. Each item lists what phase 1 must prepare (the "hook") and what will be built later.

## Phase overview
| Phase | Theme | Main content |
|---|---|---|
| 1 (now) | DATOMS monitoring | Portfolio map, project page, equipment, energy, alerts, explorer, admin. Pilot on GHAFWOODS, then all DATOMS sites. |
| 2 | More site data | Manpower and HSE, tracked materials, weather, gallery / drone / site photos, live CCTV, a read-only feed for the reporting app |
| 3 | Digital twin | BIM models linked to live data by building / level / zone |
| 4 | Intelligence | AI camera events, analytics, utilisation insights, predictions |
| Ongoing | Growth | More sites, more users, more sensor types, more data platforms, more developers |

## Future features and the hooks phase 1 must leave
| Future feature | From the client brief | Hook phase 1 must leave | Later work |
|---|---|---|---|
| **Manpower and HSE** (Info Box 1: today's labour, direct, subcontractor, man-hours, safe man-hours, LTIFR; trend page) | Workforce management and access control | A slot on the project page behind a feature flag. The generic telemetry model (`telemetry.packet` jsonb plus the parameter dictionary) can hold daily counts from any source as a site-level record (`core.asset.kind = 'site_metric'`, ADR 0009), which never appears as equipment. A `source_system` column on every source record. | Connect the access-control or HSE system as a new connector writing to the same tables |
| **Tracked materials** (Info Box 4: total / on time / possible delay / delayed; table of Serial No, Package, Supplier, LPO, Order date, Required-on-site date, Status, Last update; "add more materials") | Material management (scaffold, formwork), concrete delivery tracking | A slot on the project page. A `materials` module folder reserved. The schema is drafted in `db/schema.sql` (FUTURE TABLES section) but not created yet. | Confirm the source (DATOMS sensors or entry in Nexus). If entry in Nexus, this becomes the first write feature, with its own roles. |
| **Weather box** (temperature, humidity, wind) | Structure sheet L1 | A slot on the project page. Project coordinates are stored. Site-level values fit a `kind = 'site_metric'` record (ADR 0009). | A weather connector (one external API) with a cache |
| **Project gallery, drone library, site photos / videos** | Structure sheet L2 | Blob Storage in the infrastructure. A `media.read` permission already in the role model. | Media module: upload, SAS links, thumbnails, video streaming |
| **Live CCTV and AI camera events** | AI and CCTV real-time visibility | A `cctv.view` permission. Room for an overlay button. Events have a generic `source_system` and `category`. | Video platform integration (embed or HLS proxy). AI events go into the same `events` table. |
| **Tower crane utilisation** (usage rates, idle time, load data) | Core capability | Assets and parameters are generic, so crane parameters flow in from DATOMS automatically. (The DATOMS parameter list of 12 Oct 2026 has no crane category; whether cranes are connected is Q33.) | Crane detail page only if wanted |
| **Asset tracking** (buses, forklifts, boom lifts, trucks; location over time) | Core capability | `telemetry.asset_location_current` and `telemetry.asset_location_history` tables (see schema). The map renders moving assets from the latest location. | Track playback and geofence views (geofences come from the source, never from Nexus) |
| **Energy (iEnergy)** | Core capability | The energy module is built on DATOMS. A connector interface allows another energy source. | An iEnergy connector if it is not fed through DATOMS |
| **Read-only feed to the reporting app** | No reports in Nexus | OpenAPI contract, service-principal auth, project scope, audit log | A `/reporting/v1` read-only API or database views for a service account |
| **BIM digital twin** | Later goal | `building`, `level` and `zone` tables now (nullable links on assets). Blob storage. ArcGIS SceneView already in the frontend. | Option A: ArcGIS GeoBIM / Building Scene Layers (I3S) in the same ArcGIS SceneView, which needs no new viewer. Option B: Autodesk APS viewer as a separate route. Model elements are linked to zones and assets through a `bim.element_link` table. Decide with an ADR. |
| **AI and analytics** | Better decisions | History is kept in PostgreSQL: raw packets for 90 days, 5-minute rollups for 60 days, hourly for 5 years and daily forever. Archiving raw partitions to Blob as Parquet is **deferred** (ADR 0008). **Raw packets older than 90 days are lost for good unless Innovo decides to archive (Q15)**, so decide before AI work needs them. Clean, typed telemetry schema. | A separate Python service reading a read replica. Results are shown as clearly labelled "insights", never as source data. |
| **Another data platform** (besides DATOMS) | Connect more pilots | The connector pattern: `packages/connectors/<name>` implements one interface and writes to the same tables. `source_system` and `external_id` are on every synced record. | A new connector package and a worker job. The screens do not change. |
| **Real-time below 1 minute** | User wish | Live push already goes through Web PubSub. The worker is the only part that talks to DATOMS. | If DATOMS offers WebSocket, MQTT or webhooks: add an ingest endpoint or subscriber and an Azure Service Bus queue. The screens do not change. |
| **Native mobile app** | Maybe | All features behind one API. Entra auth works on mobile. | A React Native client only |
| **Many more users and sites** | Growth | A stateless API, Web PubSub, aggregates, and a load-test harness | Scale out containers, add Redis, a read replica, partitioning (see `12-scalability.md`) |

## Rules to keep the future open
1. Never assume DATOMS is the only source. Use `source_system` and `external_id`, and keep the connector interface.
2. Never hard-code asset types, parameters, statuses or sites.
3. Every new feature is a new module folder with its own tables and its own permission keys.
4. Feature flags (`feature_flag` table plus env) hide unfinished slots, so the UI layout never needs reshuffling.
5. Keep building, level and zone IDs on assets and events, even while they are null.
6. Any new long-lived decision gets an ADR in `docs/adr/`.

## Team growth plan
| When | Hire | Takes over |
|---|---|---|
| Now | Ahmed (backend), colleague (frontend) | Everything, with Claude Code agents |
| Phase 1 pilot | QA / test engineer | Test plans, end-to-end and load tests |
| Phase 2 | Second backend developer | Connectors (HSE, materials, media) |
| Phase 2 | UI/UX designer | Design system, new modules |
| Phase 3 | BIM / 3D developer | Digital twin (ArcGIS SceneView or APS) |
| Phase 3+ | DevOps / cloud engineer | Platform, cost, security operations |
| Phase 4 | Data engineer or data scientist | Analytics and AI service |

The repo layout (`05-file-structure.md`) gives each of these people a clear folder to own.
