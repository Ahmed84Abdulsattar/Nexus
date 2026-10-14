# 0012 · Project source identity: a link table

- **Status:** accepted (decision D10, Ahmed, 2026-10-14)
- **Date:** 2026-10-14
- **Deciders:** Ahmed, with the architect agent

## Context
- **Today `core.project` holds exactly one source identity.** `source_system` and `external_id` are `NOT NULL` and unique together (`db/schema.sql` on `main`; the S1-01 branch is the same for `core.project`). That suits a project that a source creates. It does not suit a project that an admin creates.
- **DATOMS sends no site data yet** (Q21, Q22). The S2-02 live test (2026-10-12) showed that bulk rows carry only `asset_id`, `success` and `data {time, parameters}`. So until the site fields are mapped, every prod project is created by an admin (R-63, task S3-09, decision S2 D2). Those projects have no real source identity. Under the current schema an admin would have to make one up, which breaks hard rule 1 and makes hard rule 8 meaningless.
- **Later, the DATOMS site must attach to the same Nexus project.** When DATOMS starts sending sites, the admin-created GHAFWOODS project must be joined to the DATOMS site, not duplicated or replaced. Its project id, `project_access` grants, events, read markers and asset assignments all hang off `core.project.id` and must not move.
- **One project, several sources (`13`).** Phase 2 brings HSE / access control, materials and weather. Phase 3 brings BIM (an ArcGIS or Autodesk project id). Each of these will know the same Innovo site by its own id. `13` rule 1 says "never assume DATOMS is the only source".
- **Hard rule 8:** never delete synced rows. Keep `source_system` + `external_id` and the building / level / zone links (BIM-ready).
- **Hard rule 3:** no site lists in code. Sites come from data: a source, or admin entry (Q43 asks Innovo for the pilot site list).
- **Linking today (`07` §6, backlog S3-02):** "link a new DATOMS site to a Nexus project if the name matches exactly, otherwise add it to an unlinked list for admins". The S3-02 acceptance check is "no guessed links; unmatched items listed". `integration.link_todo` already allows `entity_type = 'site'`.
- **Other ADRs:** 0001 (the `portfolio` module owns projects; modules own their tables), 0009 (`kind` is unaffected), 0010 (sites come from the bulk response once the field names are known) and 0011 (identity is keyed by source values only, never by a Nexus mapping).
- **Scale:** 500 sites is the design target, so the link table holds about 500 to 2,000 rows. Size is not a factor.

## Decision
**`core.project` is a Nexus-owned row with no source columns. Every source identity of a project is a row in a new link table, `core.project_source`.** A project can have zero, one or many links. An admin-created project simply has no link until a source site is linked to it. Link rows are never deleted: unlinking and retiring set timestamps.

### 1. The link table `core.project_source`
| Column | Type | Meaning |
|---|---|---|
| `id` | `uuid` PK, default `gen_random_uuid()` | Lets the admin API address one link (unlink, change `feeds_fields`) |
| `project_id` | `uuid NOT NULL` → `core.project(id)` | The Nexus project. Never updated: to move a source id to another project, unlink it and insert a new row. |
| `source_system` | `text NOT NULL` → `core.source_system(code)` | For example `datoms`, and later `hse` or `aps`. Dev only: `sample`. |
| `external_id` | `text NOT NULL` | The site id exactly as the source gives it, stored as text. Never updated. |
| `link_method` | `text NOT NULL`, `CHECK IN ('created','auto_name','admin')` | How the link was made. `created`: the worker created the project from this source record, or a seed or the backfill created it. `auto_name`: the S3-02 exact-name rule (section 4). `admin`: an admin linked it (linking to-do or R-63). Never updated. |
| `feeds_fields` | `boolean NOT NULL DEFAULT false` | Whether this source may update the project's descriptive fields (section 4.4) |
| `source_name` | `text` | The site name as the source last reported it. Display and audit only; never joined on. |
| `source_payload` | `jsonb` | The site record as last reported (moved from `core.project`). Written on change only, never on every poll. |
| `first_seen_at`, `last_seen_at` | `timestamptz` (nullable) | When the source first and last reported this id. `NULL` while an admin has registered the id but the source has not reported it yet. `last_seen_at` is refreshed at most once per catalogue interval (hourly), never on every poll (`06` §4, "no per-poll bookkeeping"). |
| `retired_at` | `timestamptz` | The **source** stopped reporting this id (the safe-retire rule, section 5). The link still holds the identity. |
| `linked_at` | `timestamptz NOT NULL DEFAULT now()` | When the link was made (UTC) |
| `linked_by` | `uuid` → `access.app_user(id)` | The admin who made it. `NULL` for links the worker, a seed or the backfill made. |
| `unlinked_at`, `unlinked_by`, `unlink_reason` | `timestamptz`, `uuid` → `access.app_user(id)`, `text` | **Nexus** removed the link (an admin decision). The row stays as history. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Touched by the usual `core.touch_updated_at()` trigger |

**Keys and constraints**
- `UNIQUE (source_system, external_id) WHERE unlinked_at IS NULL` (partial unique index `project_source_active_uq`). A source id belongs to **at most one project at a time**. A retired link still counts, so a site that comes back attaches to the same project. The index is **partial, not a plain unique constraint**: a wrong link is fixed by unlinking it and inserting a new row, so both rows must be able to exist. A plain unique constraint would force an in-place update of `project_id` and lose the trail.
- `UNIQUE (project_id) WHERE feeds_fields` (`project_source_feeds_uq`): at most one link per project feeds its fields.
- `UNIQUE (project_id) WHERE link_method = 'created'` (`project_source_created_uq`): a project has at most one origin, ever.
- `CHECK ((link_method = 'admin') = (linked_by IS NOT NULL))`: admin links always say who made them, and system links never claim a user.
- `CHECK (unlinked_at IS NOT NULL OR (unlinked_by IS NULL AND unlink_reason IS NULL))`.
- `CHECK (NOT (feeds_fields AND unlinked_at IS NOT NULL))`: an unlinked row never feeds fields.
- `CHECK (external_id = btrim(external_id) AND external_id <> '')`.
- No `ON DELETE CASCADE` anywhere: projects and links are never deleted.
- No extra index on `project_id` until a measured slow query asks for one (`06` §7). The table holds hundreds of rows.

**Ownership:** the table belongs to the `portfolio` module (`03` §3). `integrations` (linking to-do) and the worker's linking step use the portfolio service, or write the same rows under the grants below.

**Grants (`db/roles.sql`):**
- `nexus_worker`: `INSERT`; `UPDATE (source_name, source_payload, first_seen_at, last_seen_at, retired_at)`.
- `nexus_api`: `INSERT`; `UPDATE (feeds_fields, unlinked_at, unlinked_by, unlink_reason)`.
- Neither role can update `project_id`, `source_system`, `external_id`, `link_method`, `linked_at` or `linked_by`. Neither role has `DELETE`.

### 2. What happens to `core.project.source_system` / `external_id`: migrate, then drop
- The S3-09 migration copies each existing project's identity into a `core.project_source` row (`link_method = 'created'`, `feeds_fields = true`, `linked_at = project.created_at`, plus its `source_payload`, `first_seen_at` and `last_seen_at`).
- It then **drops** `source_system`, `external_id`, `source_payload`, `first_seen_at` and `last_seen_at` from `core.project`, together with the `UNIQUE (source_system, external_id)` constraint.
- **Why drop rather than keep them as "origin":** two places for identity would drift. A column called `source_system` on `core.project` would also keep inviting joins on it, because every other synced table uses that pair as its identity. The origin is not lost: it is the link with `link_method = 'created'`, and at most one can exist.
- `core.project` keeps `state_origin`, `created_at`, `updated_at` and `retired_at`.

### 3. How an admin-created project is marked: no source row
- **An admin-created project has no `core.project_source` row** until a source id is linked to it. Nexus does **not** add a `nexus` row to `core.source_system` and does not invent an `external_id`. A link row means "an outside system knows this site by this id". A self-reference would carry no information, and it would be counted by every "does this project have a source?" query.
- **Who created it and when** is in `audit.log` (`admin.project.create`, written in the same transaction, R-05).
- **Derived states (no extra column):**
  - *Origin* = the source of the `created` link, if there is one; otherwise "created in Nexus".
  - *Awaiting a source* = no active link (`unlinked_at IS NULL`). The admin projects screen can filter on this.
- `state_origin` is unchanged. It still marks a `state` set by an admin (R-63).

### 4. Linking (S3-02, the linking to-do, R-63)
Where field names are needed, the worker works on `SourceSite` records that `packages/datoms-client/src/mapping.ts` produces (hard rule 2). Nothing below reads a DATOMS field name.

**4.1 Resolving a reported site (worker, in this order; the first rule that applies wins)**
1. **Identity.** If there is an active link with this `(source_system, external_id)` (`unlinked_at IS NULL`), that is the project. This is not an auto-link; it is the identity. Refresh `source_name`, `source_payload` (on change) and `last_seen_at` (at most hourly). If the link was retired, clear `retired_at` and count it in `sync_run.details`. If the **project** is retired, do not un-retire it. Reopen the site's `link_todo` row for an admin instead.
2. **Exact name (`auto_name`).** Only when setting `linking.auto_link_by_name` is `true` (default `true`). The candidates are active projects (`retired_at IS NULL`) where `core.normalise_name(project.name) = core.normalise_name(site name)`. `core.normalise_name(text)` is one immutable SQL function that trims, collapses runs of whitespace into one space and lower-cases. It does **nothing else**: no fuzzy, partial, trigram or similarity matching. Auto-link only if **exactly one** candidate exists **and** that candidate has **no active link from the same `source_system`**. Then insert a link with `link_method = 'auto_name'`, `linked_by = NULL`, `feeds_fields = false`, and count it in `sync_run.details`.
   - The "no active link from the same source" condition stops two different DATOMS sites with the same name from merging into one project.
   - If Q22 shows that sites carry an Innovo project code, a code-equality rule can be added before the name rule by amending this ADR. It is not assumed now.
3. **Otherwise, no guessing.**
   - If setting `linking.create_projects_for_new_sites` is `true` **and there are zero name candidates**, the worker creates a `core.project` from the site, with `state` from the source or `unknown` (`07` §6), and a link with `link_method = 'created'` and `feeds_fields = true`.
   - In every other case (ambiguous, a name match blocked by an existing link, or creation switched off), the worker upserts `integration.link_todo` (`entity_type = 'site'`, `payload` = the mapped `SourceSite`). `suggested_project_id` is set **only** when exactly one exact-name candidate was blocked by its existing link, so the admin sees why it did not link. It is never set from similarity.
   - **`linking.create_projects_for_new_sites` defaults to `false`.** Admins create the pilot projects by hand now (Q43). If the worker also created projects, any name that differs slightly (for example "Ghafwoods" vs "GHAFWOODS - Phase 1") would give two projects for one site, and projects are never merged or deleted. An admin turns the setting on once the existing projects are linked. Whether Innovo wants new sites to appear on the map automatically or after an admin check is a question for Innovo (follow-up below). The setting is data, so the answer needs no code change.
- The worker keeps the active `(source_system, external_id) → project_id` map in memory. It reloads the map when a link changes and at each catalogue run, so the poll does not query the link table on every row.

**4.2 Assets of a site.** A source asset's project is the project its source site resolves to through 4.1 (`07` §6). Asset identity is not changed by this ADR (section 6). Principle: **a source never silently overwrites an admin's asset assignment.** If an asset's resolved project differs from the `project_id` an admin set (R-63), the worker leaves the asset alone and raises an `asset` linking to-do. How S3-02 records "assigned by an admin" (for example an additive `core.asset.project_origin` column, like `state_origin`) is S3-02's design. It needs no ADR.

**4.3 Admin actions (API, `admin.projects.manage` or `admin.integrations`; each one audited in the same transaction)**
- **Link from the to-do:** resolving a `site` item with "link to project P" inserts a link (`link_method = 'admin'`, `linked_by` = the admin) and sets the to-do to `linked`, `resolved_by` and `resolved_at`.
- **Register a source id in advance (R-63):** an admin may add `{ sourceSystem, externalId }` to a project before the source reports it, for example from the DATOMS portal or the Q43 list. The worker then resolves the site by identity (rule 1) and fills `first_seen_at`. An id that is already actively linked gives 409. The source system must exist and be enabled.
- **Unlink:** sets `unlinked_at`, `unlinked_by` and `unlink_reason`, and sets `feeds_fields = false`. It never deletes. If the site has a `link_todo` row, its status goes back to `open`. If the source still reports the site, rule 2 or 3 applies on the next run, so the item is never lost. Unlinking does **not** move assets, events or history by itself. Assets are reassigned explicitly (R-63).
- **Change `feeds_fields`:** an explicit admin choice. Switching it on while another link feeds the project gives 409; the admin switches the other one off first.
- **Retire a project:** sets `core.project.retired_at` (never delete). The API allows this only for projects without an active `created` link; the worker owns retirement of source-created projects (section 5). Un-retiring follows the same rule.
- **Duplicate names:** S3-09 rejects (409) creating a project, or renaming one, to a name whose `core.normalise_name` equals that of another active project. This keeps rule 4.1.2 usable. Duplicates created by a source are left as reported and go to the to-do.

**4.4 Which source may change project fields**
- Only the link with `feeds_fields = true`, if there is one. The worker writes a descriptive field (name, coordinates, district, type, address, boundary, client / consultant / PM per Q18) only when the source **reports** a value. A missing field is "absent" and never clears a value (`07` §4 item 7). `state` is written only while `state_origin = 'source'` (R-63, unchanged).
- Links that the worker makes to an **existing** project (`auto_name`) and admin links default to `feeds_fields = false`. So linking DATOMS to the admin-created GHAFWOODS project never overwrites what the admin entered. The source values remain visible in `source_name` and `source_payload` for comparison.
- **Watch:** per-field ownership (for example an admin fills coordinates, and the feeding source later starts reporting them) is decided when the DATOMS site fields are mapped (Q21, Q22), by extending the `state_origin` idea to the fields concerned. Until then no source feeds any prod project, because DATOMS reports no sites.

### 5. Retire and unlink: never delete, keep the trail
- **Source-side (worker), `retired_at` on the link:** set only by the same safe-retire rule as assets (`06` §4, `07` §6). That means a complete walk, missing in `catalogue.retire_after_misses` consecutive complete walks, and the `catalogue.retire_max_fraction` stop. The exact walk for sites is defined when site fields are mapped, because sites come from bulk rows rather than a paged list (ADR 0010). A retired link keeps the identity.
- **Project retirement by the worker:** only when the project's `created` link is retired **and** the project has no other active, non-retired link. The worker never retires a project an admin created. It never un-retires a project (rule 4.1.1).
- **Nexus-side (admin), `unlinked_at` on the link:** see 4.3.
- **The trail:**
  - The link rows themselves: method, who, when, and why for unlinks. They are immutable except for the columns listed in the grants.
  - `audit.log` for every admin action: `admin.project.create`, `admin.project.update`, `admin.project.retire`, `admin.project_source.link`, `admin.project_source.unlink`, `admin.project_source.update`.
  - `integration.sync_run.details` counts for worker links, retires and reappearances (S2 decision D7).

### 6. Effects
- **Asset identity: explicitly out of scope.** `core.asset` keeps `source_system` + `external_id` (`NOT NULL`, unique together). Reasons:
  - Every phase 1 asset is a sensor of exactly one source.
  - No asset is created by an admin.
  - Telemetry history is keyed by `asset_id`, so moving assets between projects needs no identity change.
  
  If Q11 shows that DATOMS asset ids can change (legacy integer → UUID), a later ADR may add `core.asset_source` with the same shape as this table. `building`, `level` and `zone` also keep their nullable single identity columns.
- **`withProjectScope`, `ProjectScopeGuard`, `access.user_project_ids()`, `project_access`, Web PubSub groups: no change.** Scope is by `core.project.id`, which this ADR keeps stable. The link table is **never** used for scope.
  - Source links are shown only on admin endpoints (`/admin/projects/{projectId}/sources`, the linking to-do). Those still pass the global `ProjectScopeGuard`.
  - The user-facing project DTO carries no source ids. Admin DTOs use `sourceSystem` / `externalId`, never `datomsId` (`10`).
  - Linking does not change `project_access`, so it does not invalidate the access cache. Asset reassignment is covered by R-63's own rules.
- **Equipment queries and views:** unchanged. No view reads `core.project.source_system` or `external_id`. `kind = 'physical'` filters (ADR 0009) are untouched.
- **Events:** `events.event.project_id` is still written at ingest time from the asset's project, or from a site id resolved through rule 4.1.1. Events written before an asset moved stay with the old project, as today.
- **Sample seed (S2 decision D1):** `db/seeds/dev-projects.sql` (local and dev only) inserts its own `core.source_system` row `sample`. Each sample project gets one link (`sample`, for example `sample-site-a`, `link_method = 'created'`, `feeds_fields = true`), **except one project with no link**, which stands in for an admin-created project awaiting a source. `sample` never appears in `db/schema.sql` or in prod.
- **BIM readiness: improved.**
  - In phase 3 a project can carry its BIM or GIS project identity (for example an Autodesk ACC/APS project id or an ArcGIS portal item) as another link row. That needs a new `core.source_system` row and no schema change. HSE, materials and weather systems (`13`) work the same way.
  - `bim_ref` and the building / level / zone identity columns are untouched.

### 7. Migration steps (added by S3-09; described here, not written)
- **File:** `db/migrations/NNNN_project_source.sql`, with `NNNN` = the next free number when S3-09 merges (`06` §8 rule 1). If merges follow the planned order (`0001_init` from S1-01, S2-06's `last_group_ids` from D5, S3-01 phase 2's `sync_run.details` / `source_lifecycle_status` from D7), it is **`0004_project_source.sql`**. One migration, in the S3-09 PR, with `db/schema.sql` updated to match and `pnpm db:check` green.
- **Up:**
  1. Create `core.normalise_name(text)` (immutable SQL function).
  2. Create `core.project_source` with the columns, checks, partial unique indexes and touch trigger from section 1.
  3. Backfill one `created` link per existing project from its current columns (only seeds and test data can exist before S3-09; no admin project exists yet).
  4. Drop `UNIQUE (source_system, external_id)` and the columns `source_system`, `external_id`, `source_payload`, `first_seen_at` and `last_seen_at` from `core.project`. The table is small and not hot, so no lock concern (`06` §8 rule 3).
  5. Insert the settings `linking.auto_link_by_name` (`true`) and `linking.create_projects_for_new_sites` (`false`), with descriptions, in both the migration and the `db/schema.sql` seed block.
- **Down:**
  - Refuse (raise an exception with a clear message) if any project has no active link or more than one. Such data cannot be expressed in the old schema without inventing an identity.
  - Otherwise re-add the five columns, fill them from each project's single active link, restore `NOT NULL` and the unique constraint, and drop the settings, the table and the function.
  - The down is lossy for unlinked history rows. This is accepted and stated in the migration header.
- **Same PR:** `db/roles.sql` grants (section 1), plus `nexus_api` `UPDATE (retired_at)` on `core.project` for the admin retire rule. Also: regenerated Kysely types (`db/src/types.ts`), the seeds and benches that insert projects (`db/seeds/dev-projects.sql` if S2-01 has merged, `db/seeds/scale-100-sites.ts`, `db/bench/01-load-projects-assets.sql`, `db/bench/screens.ts`), and the tests that insert projects with `source_system` / `external_id` (`db/test/*`, `apps/api/test/*`).

## Options considered
| Option | Pros | Cons |
|---|---|---|
| **A. Columns on `core.project`** (today). Admin projects get a `nexus` source row and their own uuid as `external_id`. Linking a DATOMS site **replaces** the pair. A variant makes the pair nullable, as on `building`. | No new table; one-row reads | An admin project carries a made-up identity (rule 1). Replacing the pair loses the earlier identity, unless it is copied somewhere, which is option B done badly. One source per project, so phase 2 sources (HSE, materials, BIM) need this change anyway. "Who linked it, when, and why it was unlinked" lives only in the audit log. |
| **B. Link table `core.project_source` (chosen)** | Admin projects need no fake identity. Linking is an insert, not an identity change, so the project id, access grants, events and history never move. Many sources per project (`13`). Every source id is kept forever with its link history (rule 8). Retire (source-side) and unlink (Nexus-side) are separate and explicit. Scope is unaffected. | One more table and join for admin and worker code. Identity is no longer on the project row, so code must not look for it there (review checklist). The worker needs an in-memory id map. A one-time migration that drops columns. |
| **C. A project table per source** (for example `datoms_site`, later `hse_site`, each with a nullable `project_id`) | Typed, source-specific columns; staging of unlinked sites | One table per source puts source knowledge in the schema and breaks the connector pattern ("a new source adds a package and a schedule; tables and screens don't change", `03` §5, `13`). Linking logic is repeated per source. A generic variant (one `source_site` table for all sources) collapses into option B, but without link history. |
| D. Keep the columns **and** add the link table | No column drop | Two places for identity that will drift; every reader must know which one wins |

## Consequences
**Easier**
- R-63 admin projects can exist with honest data.
- S3-02 auto-link and the linking to-do become inserts and updates on one table.
- Phase 2 and 3 sources attach to existing projects with no schema change.
- No project ever needs to be merged or duplicated to change its source.

**Harder or to watch**
- Code and reviewers must not look for source identity on `core.project`. Add to the `14` review checklist: "a project's source ids are read only from `core.project_source`; never use it for scope".
- Auto-link depends on admins typing site names as the source reports them. If DATOMS names differ, items wait in the to-do. This is by design: no guessed links.
- With `linking.create_projects_for_new_sites = false`, a new DATOMS site appears in the linking to-do within the catalogue interval, not on the map, until an admin acts or turns the setting on. S3-01's backlog acceptance check ("new DATOMS site appears in Nexus within 1 hour") is read as "appears in Nexus (map or linking to-do) within 1 hour".
- Per-field ownership between an admin and a feeding source is deferred to the site-field mapping (section 4.4).
- Merging two projects is still not supported. A duplicate is resolved by unlinking, relinking, reassigning assets and retiring the extra project.

**Dependencies**
- **S3-09** (R-63 admin projects API) adds the migration and the admin source endpoints.
- **S3-02** (auto-link) depends on S3-09's migration.
- S2-01 does not wait: it reads `core.project` as stored and must not select the source columns.

**Follow-up doc changes (not made in this ADR's PR; each lands with S3-09 or S3-02, or as a docs-only PR before them)**
- `docs/00-README.md`: add ADR 0012 to the decision list.
- `docs/06-database.md`:
  - §1: add `project_source` to `core`.
  - §2: ER diagram (`SOURCE_SYSTEM ||--o{ PROJECT_SOURCE`, `PROJECT ||--o{ PROJECT_SOURCE`; remove `SOURCE_SYSTEM ||--o{ PROJECT`).
  - §3 items 1 and 2: project identity lives in the link table; retire vs unlink.
  - §4: the live-poll site step and the linking writes.
  - §9: grants.
- `docs/07-datoms-integration.md`:
  - §6: linking rules 4.1 to 4.3, the two settings, no project creation by default, identity-first resolution.
  - §3.5 table: target `core.project` + `core.project_source`.
  - §5 `live-poll` steps ("upsert sites" → resolve sites).
- `docs/10-api-design.md`:
  - `/admin/projects/{projectId}/sources` (GET, POST to register or link, PATCH `feedsFields`, POST `…/{linkId}/unlink`).
  - Project retire on `PATCH /admin/projects/{projectId}`, and 409 on duplicate names.
  - `/admin/link-todo` site resolution.
  - The user-facing project DTO carries no source ids.
- `docs/02-requirements-phase1.md`:
  - R-62: exact-name rule as defined here.
  - R-63: register source ids, retire, task S3-09.
  - R-10 note: map or to-do within the interval.
- `docs/03-architecture.md`:
  - §3: `portfolio` owns project sources.
  - §4.1 / §4.2 notes: sites resolve through `core.project_source`.
- `docs/08-auth-and-access.md`: no rule change (scope is by project id). Check only that any list of audited admin actions includes the new action names.
- `docs/13-roadmap-future.md`: the "another data platform" and BIM hooks name `core.project_source` for project-level ids.
- `docs/14-testing-quality.md`: the review checklist line above.
- `docs/source/backlog.md` (and the spreadsheet by hand):
  - Add the S3-09 row, which references this ADR.
  - S3-02 depends on S3-09.
  - S3-01 acceptance wording.
- `docs/open-questions.md`:
  - A new question for Innovo: should new DATOMS sites become projects automatically, or wait for an admin check? It decides `linking.create_projects_for_new_sites`.
  - Extend Q43 to ask for the DATOMS site id of each pilot site, if DATOMS can give it, so admins can register it in advance.
  - Note on Q11 that asset identity stays single-source (section 6).
- `docs/sprints/S2.md`: D10 is done (ADR 0012 accepted).

**How to reverse:** the S3-09 down migration restores the columns as long as every project has exactly one active link. Once projects with zero links or several links exist, reversing needs a new ADR that decides how to represent them (most likely option A's nullable variant, plus losing all but one source per project).
