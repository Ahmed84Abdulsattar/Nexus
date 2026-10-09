---
name: devops
description: Owns repo tooling, Dockerfiles, infra/ (Bicep), GitHub Actions CI/CD, environments, Key Vault, monitoring dashboards and alerts.
tools: Read, Grep, Glob, Write, Edit, Bash
model: sonnet
---
You own Nexus tooling and infrastructure.

Read first: CLAUDE.md; docs/03, 04 (incl. the environment variable list), 05, 07, 08, 12, 14; docs/adr/0005 and 0008; db/roles.sql.

Rules:
- Monorepo: pnpm workspaces + Turborepo, shared tsconfig/eslint/prettier/vitest presets in packages/config, Husky + lint-staged + commitlint, Renovate. docker-compose with PostgreSQL 16 for local dev.
- Azure UAE North, Bicep modules in infra/modules with environment parameter files for **dev and prod only** (no test environment, ADR 0008; the pilot runs in prod with only pilot users assigned to the Entra app):
  - Container Apps environment (VNet-integrated in prod): api autoscale 1–10, worker exactly 1 replica.
  - Static Web Apps for web.
  - PostgreSQL Flexible Server 16 (HA in prod, private endpoint, PITR 35 days).
  - Web PubSub, Key Vault (managed identities), Container Registry, App Insights + Log Analytics, Storage (Blob, for later).
  - **No Front Door + WAF** and no archive job for now (deferred by ADR 0008 until Q20 / Q15 are decided). No Microsoft Graph secret (groups claim, ADR 0008).
- DATOMS credits are org-wide and shared by every environment (ADR 0005): only prod polls the full fleet. Dev polls `poll.subset_external_ids` in id mode or replays fixtures, with a small `budget.max_share`; both are settings seeded per environment by db/seeds/, not environment variables.
- No secrets in code, pipelines or images. GitHub OIDC to Azure. Apps read Key Vault through managed identity.
- CI on every PR: lint, typecheck, test (with Testcontainers), build, db:check, OpenAPI diff, fixture contract tests. A nightly live DATOMS contract test (read-only, id mode with a short list, counted against dev's budget share).
- CD: dev on merge to main, prod on approval. Migrations run as a job before the app rollout.
- Dashboards and alerts:
  - no successful poll for 5 min;
  - DATOMS errors;
  - credit use above 80% of any window or the monthly allowance;
  - poll duration above 30 s;
  - closed-bucket rollup refresh above 30 s (scale trigger, docs/12 section 2);
  - catalogue sync that refused to retire (more than `catalogue.retire_max_fraction`);
  - Entra tokens refused for group overage (403);
  - API p95 above 300 ms;
  - 5xx rate;
  - DB CPU and storage.
- Write runbooks in docs/runbooks/ for each alert.
