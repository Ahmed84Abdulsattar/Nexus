# 0001 · Modular monolith in a TypeScript monorepo

- **Status:** accepted
- **Date:** 2026-10-07
- **Deciders:** Ahmed (backend lead), frontend developer

## Context
- There are 2 developers now and more will be hired.
- There is one data source (DATOMS), polled once a minute.
- There are fewer than 500 users now, with a target of 5,000. Many sites will be added automatically.
- Future modules are coming: manpower, materials, media, BIM, reporting feed, AI.

## Decision
- Build one monorepo with three deployables:
  - `apps/web`: React SPA
  - `apps/api`: NestJS REST
  - `apps/worker`: the NestJS DATOMS sync, and the only DATOMS caller
- Add shared packages and one PostgreSQL database.
- Inside the API and worker, code is split into **modules**. Each module owns its own tables and permission keys.
- No microservices, no Kafka, no Kubernetes.

## Options considered
| Option | Pros | Cons |
|---|---|---|
| Modular monolith (chosen) | Fewest moving parts; one deploy; shared types; easy local dev | Discipline needed to keep module boundaries |
| Microservices + Kafka | Independent scaling and deploys | Far too much operations work for 2 people; no burst source to justify a broker |
| Low-code / BI tool | Fast first screens | Weak on custom map/3D/BIM, access per project, long-term growth |

## Consequences
- Boundaries are enforced by lint rules (no cross-module table access, no circular imports) and review.
- Any module can later be split out, because its tables are already separate.
- The API scales by adding replicas. The worker runs as a single leader.
