# 01 · Product vision: what Nexus is and why

Read this first. Everything else in `docs/` explains how to build what this file describes.

## In one sentence
Nexus by Innovo is Innovo Group's internal, read-only monitoring platform. It shows every Innovo construction site on one interactive UAE map and lets employees drill down from the whole portfolio to a single project and then to a single piece of equipment, with live data.

## Who owns it and who uses it
- **Owner:** Innovo Labs (the Digital and Innovation team at Innovo Group).
- **Users:** Innovo employees only, signed in with their Microsoft work account (Entra ID). There are no external users, no public pages and no self sign-up.
- **Users now:** fewer than 500. **Design target:** 5,000 users and 500+ sites with no rewrite (see `12-scalability.md`).
- **Typical users:**
  - Leadership, who look across the whole portfolio.
  - Project managers, who look at their own projects.
  - Civil and site managers.
  - Equipment and energy teams.
  - Nexus admins (Innovo Labs).

## The problem
Innovo runs many active construction projects across the UAE. Site data about equipment, energy, workforce, materials and conditions sits in separate systems. This makes decisions slower, makes it hard to compare projects, and slows the response to incidents. Innovo Labs spent about 12 months piloting sensors and connected systems with Build UAE. Nexus brings those pilots into one platform and scales them across the group.

## Objectives (from the client brief)
1. Real-time visibility across the whole portfolio from one point of access.
2. Better use of equipment and resources by showing usage and availability across sites.
3. Quicker access to on-site information so teams respond to incidents sooner.
4. Better decisions from consolidated, up-to-date operational data.
5. Safer, higher-quality, lower-cost and more productive projects.

## Core principles (these rules decide every design choice)
1. **Read-only.** Nexus monitors and tracks. It never controls a device, sends a command or writes back to a vendor system.
2. **Show data as the source reports it.** Values, units, statuses (Running, Idle, Maintenance, Off), alerts and events come from DATOMS exactly as DATOMS reports them. Nexus does not invent thresholds, statuses, alarms or calculations that the source does not provide. If DATOMS has no value, Nexus shows "no data", not a guess.
3. **One source today, many later.** Phase 1 reads only from DATOMS. Every piece of equipment on site gets its own sensor connected through DATOMS. The design must allow other platforms to be added later without changing the screens (see the connector pattern in `03-architecture.md`).
4. **Automatic growth.** New sites and assets are added in DATOMS and must appear in Nexus automatically, with no code change and no manual step.
5. **Secure by default.** Every request is checked for both role and project access. Users see only the projects they are allowed to see.
6. **Built to grow.** It is small today (fewer than 500 users, 2 developers) and grows with more developers, sites, data sources and BIM. Choose the simplest design that will not need a rewrite.
7. **Desktop, tablet and mobile.** It is fully responsive. English only. No wall-screen mode.

## The experience (from Nexus_Structure.xlsx)
- **Top level: portfolio map.** A UAE map with all Innovo sites plotted and coloured by project state:
  - Active: green
  - Central Store: blue
  - Finished: grey
  - In bid: yellow / light green
- **Level 1: project page.** Clicking a project opens its site map, with a switch between Satellite, 2D and 3D. The map shows blinking icons for tower cranes, hoists, equipment and generators, coloured by status (Running green, Idle amber, Maintenance red, Off grey). The page also has info boxes:
  - Box 2, equipment: counts and idle counts for tower cranes, hoists and all equipment.
  - Box 3, energy: diesel generators running, total load, solar generation, and the mains-to-solar ratio.
  - Placeholders for later: weather, Box 1 manpower, Box 4 tracked materials, and gallery / CCTV / drone overlays.
- **Level 2: detail pages.** Clicking an info box opens a detail page:
  - **Equipment table:** Equipment ID, Name, Type, Make/Model and current status, plus any extra data DATOMS has.
  - **Energy page:** a ribbon of key figures across the top and a table of all energy equipment (DGs, solar, mains) with DG ID, Description, Ownership (Owned/Hired) and Status (Running/Off).
  - **Trend charts** by day, week, month and year.

## Phase 1 vs. later (summary; detail in `02-requirements-phase1.md` and `13-roadmap-future.md`)
| Phase 1: build now (data from DATOMS, Entra ID, ArcGIS) | Later: prepare for now, do not build |
|---|---|
| Portfolio map, project page, equipment, energy, DATOMS alerts and notifications, data explorer, admin (users, roles, sync health) | Manpower and HSE, tracked materials, weather, gallery / CCTV / drone, AI camera events, tower crane load data, concrete tracking, read-only feed to the reporting app, BIM digital twin, AI analytics, other data platforms |

## Out of scope (do not build, even if it seems helpful)
- Device control or any write-back to DATOMS.
- Thresholds, alarms or statuses defined by Nexus.
- Reports, PDF exports or scheduled emails. A separate reporting app will read from Nexus later.
- Arabic or right-to-left layout. Wall-screen or kiosk mode. External or guest users.
- Manual data entry for sensor data.

## Success looks like
- All DATOMS sites appear on the map automatically, with live statuses no more than about 1 minute behind DATOMS.
- A user goes from portfolio to project to equipment in 3 clicks on desktop or mobile.
- No user can ever see a project they are not assigned to.
- Adding the 501st site or the 5,000th user needs no code change.
- A new developer understands the system from `docs/` in a day.
