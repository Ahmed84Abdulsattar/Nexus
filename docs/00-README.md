# Nexus docs: start here

These docs are the single source of truth for people **and** for Claude Code agents. Every agent must read the files listed for its role before writing code.

## Reading order
| # | File | What it answers |
|---|---|---|
| 01 | `01-product-vision.md` | What Nexus is, who uses it, principles, scope |
| 02 | `02-requirements-phase1.md` | Exactly what to build now (R-xx, N-xx), with acceptance checks |
| 03 | `03-architecture.md` | System design, data flows, modules, failure behaviour |
| 04 | `04-tech-stack.md` | Libraries and services to use, and the ones not to use |
| 05 | `05-file-structure.md` | Where every file goes, routes, naming, ownership |
| 06 | `06-database.md` + `../db/schema.sql` | Schema, partitions, rollups, queries, sizing |
| 07 | `07-datoms-integration.md` | DATOMS endpoints, limits, credit math, client behaviour, worker jobs |
| 08 | `08-auth-and-access.md` | Entra ID, roles, permissions, project scope, security |
| 09 | `09-map-arcgis.md` | ArcGIS map: portfolio and project maps, 2D/satellite/3D, wrapper |
| 10 | `10-api-design.md` | REST endpoints, conventions, live push messages |
| 11 | `11-frontend-guide.md` | Data display rules, tokens, responsive layout, states |
| 12 | `12-scalability.md` | Targets, triggers and actions for growth, load tests |
| 13 | `13-roadmap-future.md` | Future phases, and the hooks phase 1 must leave |
| 14 | `14-testing-quality.md` | Definition of done, test pyramid, review checklist |
| — | `adr/` | Decisions and their reasons (list below) |
| — | `source/` | Client brief, structure sheet, DATOMS API PDF, sprint sheet (inputs; read-only). Agents read the markdown copies: `brief.md`, `structure.md`, `backlog.md`. |
| — | `open-questions.md` | Questions waiting on Innovo or DATOMS (Q1–Q26, including items DATOMS has promised). Never guess these into code. |

## Decision records (`adr/`)
| ADR | Decision |
|---|---|
| 0001 | Modular monolith in a TypeScript monorepo |
| 0002 | Esri ArcGIS as the map provider |
| 0003 | PostgreSQL 16 with native partitioning and Nexus rollups, no TimescaleDB (amended by 0007) |
| 0004 | 60-second bulk polling by one worker; no message queue |
| 0005 | DATOMS credit budget per environment: only prod polls the full fleet |
| 0006 | Poll interval per asset type |
| 0007 | Phase 1 rollups: SQL only, once per closed 5-minute bucket (amends 0003) |
| 0008 | Operations simplification: app-assigned groups claim, dev + prod only, deferrals, simple 3D, slim live push with server-side subscriptions |
| 0009 | `core.asset.kind`: physical equipment vs site-level metrics |
| 0010 | The DATOMS bulk endpoint is the only telemetry source |

## Which docs each agent must read
| Agent | Must read |
|---|---|
| architect | all |
| datoms-integration | 01, 03, 05, 06, 07, 12, 13, 14 |
| backend-api | 01, 02, 03, 05, 06, 08, 10, 14 |
| database | 01, 03, 05, 06, 07, 12, 13 |
| frontend | 01, 02, 05, 09, 10, 11, 14 |
| devops | 03, 04, 05, 07, 08, 12, 14 |
| qa | 02, 10, 12, 14 |
| security-reviewer | 08, 10, 14 |

## Keeping docs true
- If code changes behaviour, update the doc in the same PR.
- A choice that changes the structure, a library or a limit needs an ADR (`adr/0000-template.md`).
- Open questions for Innovo or DATOMS go in `docs/open-questions.md`. Never guess an answer into the code.
