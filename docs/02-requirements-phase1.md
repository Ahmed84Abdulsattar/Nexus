# 02 · Phase 1 requirements

Phase 1 covers only what is fed by **DATOMS**, **Microsoft Entra ID** and the **ArcGIS map**. If a requirement needs data from anywhere else, it belongs to a later phase (`13-roadmap-future.md`). Do not build it, but leave room for it.

Each requirement has an ID (R-xx), the sprint tasks that build it (S#-##, from `docs/source/Nexus_Phase1_Sprint_Plan.xlsx`), its data source and an acceptance check.

> **DATOMS data note (ADR 0010).** DATOMS has confirmed that everything visible in its portal (sites, generators, tower cranes, statuses, locations, asset types, alerts and all parameters) is available to Nexus in the **bulk endpoint response**. Today's fleet is a small demo set (generators and tower cranes). More asset types will come later and must appear automatically.
> **Update (12 Oct 2026, `07` §3).** DATOMS gave a provisional read-only test key and the parameter list for four categories: DG Set, Fuel Tank, AC Sub-Meter and Solar Inverter (`docs/source/datoms-parameters.md`). Names and units are stored per source type (ADR 0011). The list has **no tower crane category** (and no hoist category): whether cranes are connected and what they send is Q33. Until then, crane and hoist figures show "no data yet".
> **Nexus reads telemetry only from the bulk endpoint and shows exactly what it returns, for every asset type.** There are no per-type endpoints and no separate crane handling. `GET /assets/{id}/data/latest` is used only by the CLI checks. Anything missing from the bulk response shows as "no data yet". The exact field names arrive with DATOMS's promised sample response (Q21) and field list (Q22). Until then, build against the v4 PDF shape and keep all field mapping in `packages/datoms-client/src/mapping.ts`. Never fake a missing field.

---

## A. Sign-in and access
| ID | Requirement | Source | Sprint | Acceptance check |
|---|---|---|---|---|
| R-01 | Sign in with a Microsoft work account (Entra ID, single tenant). No Nexus passwords. | Entra ID | S0-04, S0-08 | An employee signs in. A non-tenant account is refused. |
| R-02 | Roles come from Entra security groups, mapped to Nexus roles in the database by an admin. | Entra ID | S1-02, S2-06 | Adding a user to a group gives them the role at their next sign-in. |
| R-03 | Project scope: each user sees only the projects assigned to them (directly or through a group). Leadership and admins can be given "all projects". | Nexus DB | S1-02, S2-06 | A user with no access to project X gets 404 on every X endpoint (404, not 403, so the project's existence is not revealed), and X never appears in lists, search, live push or map. |
| R-04 | Navigation shows only what the role allows. | Nexus | S1-08 | A viewer sees no Admin menu. |
| R-05 | Audit log of sign-ins, admin changes and data exports. | Nexus DB | S1-04 | Each action creates a row with user, time, action and target. |

Roles in phase 1 (see `08-auth-and-access.md`):
- `admin`: everything.
- `leadership`: all projects, read.
- `project_manager`: assigned projects, read.
- `site_user`: assigned projects, read.
- `viewer`: assigned projects, limited read.

## B. Portfolio map (top level)
| ID | Requirement | Source | Sprint | Acceptance check |
|---|---|---|---|---|
| R-10 | Landing page is an ArcGIS map of the UAE with one marker per project the user can see. | DATOMS bulk: sites + coordinates (field names pending Q21/Q22) | S2-01, S2-03 | Every DATOMS site the user has access to appears. Sites without coordinates go in a "not on map" list. |
| R-11 | Marker colour shows project state: Active green, Central Store blue, Finished grey, In bid yellow / light green. | DATOMS site data (if not provided, it is an admin-held project field; raise it with the architect) | S2-03 | The legend matches the colours. The state comes from stored data, never guessed. |
| R-12 | Marker clustering when zoomed out. Clicking a marker shows a summary popup, then opens the project page. | DATOMS | S2-03 | 500 markers stay smooth (60 fps pan on a mid-range laptop). |
| R-13 | Side panel with the project list, summary tiles (number of projects by state and district), and search and filters (state, type, district, name). | DATOMS | S2-04, S2-05 | Filters update both the map and the list together. |

## C. Project page (Level 1)
| ID | Requirement | Source | Sprint | Acceptance check |
|---|---|---|---|---|
| R-20 | Site map with a basemap switch: Satellite / 2D / 3D (ArcGIS MapView for 2D, SceneView for 3D). | ArcGIS + DATOMS coordinates | S4-04, S4-05 | All three modes work. 3D shows terrain and buildings where Esri has them. |
| R-21 | Asset markers for every asset type DATOMS reports (tower cranes, hoists, equipment, generators, and new types automatically). Each asset type has its own icon. Colour shows the DATOMS status: Running green, Idle amber, Maintenance red, Off grey. A pulse marks a recent change in 2D (whether to blink continuously is Q19). Only `kind = 'physical'` assets are drawn (ADR 0009). | DATOMS bulk: asset location + status | S4-05 | The icon comes from the asset type and the colour from the DATOMS status value. An unknown type uses a generic icon. A missing status or location shows "no data yet" / "Not on map". |
| R-22 | Live updates: marker colours and info boxes update without a page refresh, within about 2 poll intervals of DATOMS (normally 60 s each). | DATOMS bulk → worker → Web PubSub | S4-02, S4-06 | A status change in DATOMS shows on screen within 2 poll cycles. |
| R-23 | Clicking an asset opens a side panel with its latest readings (all parameters, with units), last update time, faults and alerts from DATOMS, and today's running timeline, labelled "observed by Nexus" (ADR 0007). | DATOMS bulk | S4-07, S6-02 | Every parameter DATOMS returns is listed, with no hard-coded list. |
| R-24 | Info Box 2, equipment: tower crane count / idle, hoist count / idle, total equipment / idle. Only assets with `kind = 'physical'` are counted. "Total equipment" = those whose type category is `equipment`, `vehicle` or `other` (energy assets are counted in Box 3). **Crane data (Q33):** the DATOMS parameter list of 12 Oct 2026 has no tower crane (or hoist) category. Until DATOMS reports assets of that type, the tower crane and hoist rows show "no data yet", never 0; the same applies to crane rows in the equipment table and device card. | DATOMS bulk: status counts | S6-03, S6-05 | The counts equal the DATOMS portal for the same site and time. A type DATOMS does not report shows "no data yet". |
| R-25 | Info Box 3, energy: total DGs (with running state), total energy load or energy produced, solar generation, mains-to-solar ratio. | DATOMS bulk: energy values / site totals (site totals as `site_metric` records, ADR 0009; Q3) | S5-01, S5-05 | The values equal the DATOMS portal. The ratio is shown only if DATOMS provides it, or provides both inputs. |
| R-26 | Placeholders, clearly marked "coming later": Weather box, Info Box 1 (Manpower), Info Box 4 (Tracked materials), and the Gallery / CCTV / Drone overlay button. | none | S4-04 | The layout has slots for these, and the slots hide or show from a feature flag. |
| R-27 | Stale or missing data is visible: each value shows its time, and the API marks it `stale` using DATOMS's own offline rule (Q8). Until Q8 is answered, it uses the interim setting `display.stale_after_seconds` (default 300), but never less than twice the asset type's poll interval (ADR 0006). "No data" is shown as "—". A gap stays a gap; it is never filled in. | DATOMS | S7-07 | Stop the fixtures and the screen shows the last update time and a stale state. |

## D. Detail pages (Level 2)
| ID | Requirement | Source | Sprint | Acceptance check |
|---|---|---|---|---|
| R-30 | Equipment table: Equipment ID, Name, Type, Make/Model, current status (Running / Idle / Off / Maintenance), plus any extra DATOMS fields as optional columns. Sort, filter by type and status, search, paging. Only `kind = 'physical'` assets. | DATOMS asset list + asset_info + bulk status | S6-01, S6-06 | Works with 5,000 rows (virtualised). Extra fields appear automatically. |
| R-31 | Energy page: a ribbon of key figures across the top. A table of all energy equipment (DGs, solar, mains; whether fuel tanks, the new `fuel_tank` energy type, belong here is Q36) with ID, Description, Ownership (Owned / Hired), Status (Running / Off). Charts for load trend, distribution and solar trend. | DATOMS | S5-02, S5-06–08 | Ownership comes from a DATOMS field. If DATOMS lacks it, the column is hidden and reported. |
| R-32 | Trend charts with day / week / month / year choices, read from Nexus rollup tables (5 min / 1 h / 1 day). Each chart shows data coverage (samples stored per bucket against the expected number), because Nexus samples DATOMS once per poll (ADR 0007). | Nexus history (stored from DATOMS bulk polls). A DATOMS history feed is on hold (ADR 0010). | S4-01, S5-03 | A one-year chart loads in under 1 s. Thin buckets are visibly marked, never filled. |
| R-33 | Device card: the latest values, today's running timeline (labelled "observed by Nexus"), recent DATOMS alerts for one asset. | DATOMS bulk | S6-02, S6-07 | Latest values match the DATOMS portal device page. The timeline shows status changes as Nexus observed them, with ~1 poll interval precision. |

## E. Notifications and alerts
| ID | Requirement | Source | Sprint | Acceptance check |
|---|---|---|---|---|
| R-40 | Alerts and notifications are taken exactly as DATOMS reports them in the bulk response. Nexus raises none of its own. | DATOMS bulk: alerts (field names pending Q22) | S6-04 | Every alert in the bulk response for an allowed project appears once. (The bulk endpoint does not return events produced between polls; see ADR 0010.) |
| R-41 | A bell in the header with unread count, and a list filtered by site, asset, type and time. | Nexus DB | S6-08 | Read / unread state is per user. |

## F. Data explorer
| ID | Requirement | Source | Sprint | Acceptance check |
|---|---|---|---|---|
| R-50 | Pick any site, asset, parameter and time range. Show a chart and min / avg / max. Download CSV of the selected data (this is a data export, not a report). | Nexus history | S7-01, S7-03 | Any parameter DATOMS sends can be charted with no code change. The export is audit-logged. |

## G. Admin
| ID | Requirement | Source | Sprint | Acceptance check |
|---|---|---|---|---|
| R-60 | Users and roles: map Entra groups to roles, assign projects to users or groups, list users. | Entra ID + Nexus DB | S2-06, S3-07 | Changes apply at the user's next API call (cache ≤ 5 min). Live push for a removed project stops at once: the user's live connections are closed and must re-subscribe through the scope check (ADR 0008). |
| R-61 | Integration health: last catalogue sync, last poll, poll duration, delay, errors, rate-limit and credit use per window (as DATOMS reports it, against this environment's `budget.max_share`). | Worker metrics | S3-06 | Shows red if no successful poll in 5 min. |
| R-62 | Linking to-do list: new DATOMS sites or assets that could not be matched automatically to a Nexus project. | Worker | S3-02, S3-05 | Exact matches link automatically. The rest wait for an admin. |
| R-63 | Admin project management: create a project, edit name, state, coordinates and district, and assign assets to it. Used for project fields DATOMS does not hold (Q2), and **for the pilot until the bulk site fields are mapped (Q21, Q22)**. Fields set by an admin are marked `state_origin = 'admin'`, and source values never overwrite them silently. | Nexus DB | S3-05 | The pilot project GHAFWOODS can be created, located on the map and given its DATOMS assets without a code change. |

## H. Non-functional requirements
| ID | Requirement | Target |
|---|---|---|
| N-01 | Users | Under 500 now. Must work at 5,000 with only configuration and scaling changes. |
| N-02 | Sites / assets | 500 sites / 20,000 assets without redesigning screens, the API or the schema. Storage follows the **planned** capacity steps in `12-scalability.md` §2: retention settings, then archiving or moving raw packets (by ADR) from about 5,600 assets. The DATOMS credit allowance must cover the fleet (Q5, Q14). Today's fleet is under 500 assets. |
| N-03 | Freshness | Live values within about **2 poll intervals** of DATOMS at normal budget (default interval 60 s, so ≤ ~2 min; ADR 0004). A per-type interval (ADR 0006) or budget slow-down lengthens this, and the timestamps show it. Below 60 s only if DATOMS streaming or webhooks are adopted. |
| N-04 | Speed | API p95 < 300 ms for latest-value screens, < 1 s for one-year charts. First page load < 3 s on 4G. |
| N-05 | Availability | 99.5% for Nexus itself (DATOMS's target is 99.0%; Nexus keeps showing the last known data when DATOMS is down). |
| N-06 | Security | Entra ID only. Role and project scope on every request. Secrets in Key Vault. TLS everywhere. Data in UAE North. |
| N-07 | DATOMS limits | Never exceed DATOMS rate or credit limits (see `07-datoms-integration.md`). User count never changes the DATOMS call volume. |
| N-08 | Devices | Desktop, tablet and mobile browsers (latest Chrome, Edge, Safari). English only. |
| N-09 | Accessibility | WCAG 2.1 AA for colour contrast, keyboard use and labels. Status is never shown by colour alone; always add a text label or icon. |
| N-10 | Data retention | Raw packets 90 days (stays until Q15 is answered), 5-minute rollups **60 days** (decided 2026-10-08; older ranges use hourly), hourly rollups 5 years, daily rollups forever, audit log 2 years. All configurable in `core.setting`. Archiving raw partitions to Blob before the drop is deferred (ADR 0008, Q15). |
| N-11 | Observability | Every DATOMS call, sync run and API error is logged in App Insights with correlation IDs. |
