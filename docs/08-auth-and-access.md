# 08 · Authentication and access control

## 1. Entra ID setup (S0-04)
| App registration | Type | Settings |
|---|---|---|
| `nexus-api` | Web API | Exposes scope `api://nexus-api/access_as_user`. Token v2. Includes the `groups` claim (security groups only). Group overage is handled (see below). |
| `nexus-web` | SPA | Redirect URIs per environment. Auth code + PKCE. Asks for `api://nexus-api/access_as_user`, `openid`, `profile`, `offline_access`. |
| `nexus-worker` | (none) | Uses a managed identity for Key Vault and Postgres; never signs in as a user |
| `nexus-reporting` (later) | Service principal | Client credentials, app role `Reporting.Read` |

- Single tenant (the Innovo tenant only). Assignment required = yes, so only assigned users and groups can sign in at all.
- Entra security groups (suggested): `Nexus-Admins`, `Nexus-Leadership`, `Nexus-ProjectManagers`, `Nexus-SiteUsers`, `Nexus-Viewers`, plus per-project groups if Innovo wants them (e.g. `Nexus-Project-GHAFWOODS`).
- **Group overage:** when a user is in more than 200 groups, the token has no `groups` claim. The API then calls Microsoft Graph `POST /users/{oid}/getMemberGroups` with its own app token (application permission `GroupMember.Read.All`, admin consent) and caches the result for 5 min, the same as the AccessContext.

## 2. Request flow in the API
1. **EntraJwtGuard** (global). It validates the signature against the tenant JWKS (cached), plus `iss`, `aud = api://nexus-api`, `exp`/`nbf`, `tid = Innovo tenant` and `scp` contains `access_as_user`.
2. **Load the user.** Upsert `access.app_user` by `oid` (name, email, last_seen_at). An inactive user gets 403.
3. **Build the AccessContext** (cached 5 min per user + group hash):
   ```ts
   interface AccessContext {
     userId: string;
     roles: RoleCode[];                 // access.user_roles(userId, groupIds)
     permissions: Set<PermissionKey>;   // union over roles
     allProjects: boolean;              // any role.all_projects
     projectIds: Set<string>;           // access.user_project_ids(userId, groupIds) unless allProjects
   }
   ```
4. **@RequirePermission('asset.read')** on every controller method, or `@AnySignedIn()` for `/me`, `/config` and `/live/token`, or `@Public()` for `/health/*` only. A handler with none of them fails a test (default deny).
5. **Project scope.**
   - Routes with `:projectId` use `ProjectScopeGuard`, which gives 404 if the project is not in scope. It is 404, not 403, so it doesn't reveal that the project exists.
   - List and search queries go through `withProjectScope()` in the repository.
   - Asset or event routes look up the project of the asset or event first, then check scope.
6. **Audit.** Sign-in (first request per session), admin changes and CSV exports are written to `audit.log`.

## 3. Roles and permissions (seeded in `db/schema.sql`)
| Permission | admin | leadership | project_manager | site_user | viewer |
|---|:-:|:-:|:-:|:-:|:-:|
| portfolio.read | ✔ | ✔ | ✔ | ✔ | ✔ |
| project.read | ✔ | ✔ | ✔ | ✔ | ✔ |
| asset.read | ✔ | ✔ | ✔ | ✔ | ✔ |
| telemetry.history | ✔ | ✔ | ✔ | ✔ | |
| events.read | ✔ | ✔ | ✔ | ✔ | |
| explorer.use | ✔ | ✔ | ✔ | | |
| explorer.export | ✔ | ✔ | ✔ | | |
| admin.users.manage | ✔ | | | | |
| admin.projects.manage | ✔ | | | | |
| admin.integrations | ✔ | | | | |
| admin.settings | ✔ | | | | |
| audit.read | ✔ | | | | |
| All projects without assignment | ✔ | ✔ | | | |
| *Reserved:* cctv.view, media.read, bim.view | ✔ | (later) | (later) | (later) | |

Permission keys live in `packages/shared/src/permissions.ts`, the single source of truth used by the API decorators and the frontend `<Can>` component. A migration adds any new key to `access.permission`.

## 4. Live push security (Web PubSub)
- `POST /v1/live/token` returns a client access URL with `roles: ["webpubsub.joinLeaveGroup.project:<id>", …]`, only for the projects in scope. It is valid for 60 min, and the client refreshes it.
- With `allProjects` it gets `webpubsub.joinLeaveGroup` for all project groups. The portfolio summary group is `portfolio`. Users with `admin.integrations` may also join `admins`.
- Messages carry ids and values only, never anything outside the group's project.

## 5. Frontend
- MSAL `PublicClientApplication`, redirect flow on mobile and popup or redirect on desktop. Tokens stay in memory; `sessionStorage` is the MSAL cache.
- `GET /v1/me` returns the user, roles, permissions and a project count. The UI hides things based on it, but **the API is the real check**.
- Sign-out clears the MSAL cache and the live connection.

## 6. Security baseline
- HTTPS only, HSTS, helmet headers, strict CORS (Nexus web origins only), and a CSP that allows ArcGIS domains.
- Inputs are validated with zod. SQL goes only through Kysely parameter binding.
- Secrets in Key Vault: DATOMS token, ArcGIS API key (also restricted by HTTP referrer), DB credentials. Rotate them every 90 days (runbook).
- Rate limit on the API per user (e.g. 600 requests/min) to stop runaway clients.
- Dependency scanning (Renovate + `pnpm audit` in CI). A penetration test happens before go-live (S8-05).
- Data is held only in Azure UAE North.
