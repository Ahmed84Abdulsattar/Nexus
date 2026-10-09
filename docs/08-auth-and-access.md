# 08 · Authentication and access control

## 1. Entra ID setup (S0-04)
| App registration | Type | Settings |
|---|---|---|
| `nexus-api` | Web API | Exposes scope `api://nexus-api/access_as_user`. Token v2. Includes the `groups` claim set to **"groups assigned to the application"** (ADR 0008), so the token lists only the Nexus groups. |
| `nexus-web` | SPA | Redirect URIs per environment. Auth code + PKCE. Asks for `api://nexus-api/access_as_user`, `openid`, `profile`, `offline_access`. |
| `nexus-worker` | (none) | Uses a managed identity for Key Vault and Postgres; never signs in as a user |
| `nexus-reporting` (later) | Service principal | Client credentials, app role `Reporting.Read` |

- Single tenant (the Innovo tenant only). Assignment required = yes, so only assigned users and groups can sign in at all.
- Entra security groups (suggested): `Nexus-Admins`, `Nexus-Leadership`, `Nexus-ProjectManagers`, `Nexus-SiteUsers`, `Nexus-Viewers`, plus per-project groups if Innovo wants them (e.g. `Nexus-Project-GHAFWOODS`). The final role list is open question Q17.
- **Groups claim (ADR 0008):** `nexus-api` emits only the groups **assigned to the enterprise application**. Every group used in `access.group_role` or `access.project_access` must be assigned to the app; the admin screen warns when a mapped group is not in any token it has seen. Users must be **direct** members of an assigned group. Group-based assignment needs Entra ID P1 or higher (Q16 asks Innovo IT to confirm the licence and the nested-group behaviour).
- **No group overage path:** because the claim lists only the few assigned groups, the 200-group overage case doesn't arise, and Nexus does **not** call Microsoft Graph (no `GroupMember.Read.All`, no Graph secret). If a token ever arrives with an overage marker instead of `groups`, the API refuses with 403 and logs it for an admin.

## 2. Request flow in the API
1. **EntraJwtGuard** (global). It validates the signature against the tenant JWKS (cached), plus `iss`, `aud = api://nexus-api`, `exp`/`nbf`, `tid = Innovo tenant` and `scp` contains `access_as_user`.
   - Built in S1-02 (`apps/api/src/common/auth/`): the JWKS URL comes from config (`ENTRA_JWKS_URL`, default derived from the tenant id). A bad or expired token gives 401, a valid token without `access_as_user` gives 403, an unreachable JWKS gives 503. `aud` may be the identifier URI or the API client id (Q29). Until S1-01 the user, role and scope lookup sits behind the `AccessDirectory` interface with an in-memory implementation.
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
4. **@RequirePermission('asset.read')** on every controller method, or `@AnySignedIn()` for `/me`, `/config`, `/live/token` and `/live/subscriptions` (which then checks permission and scope per project itself), or `@Public()` for `/health/*` only. A handler with none of them fails a test (default deny).
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

## 4. Live push security (Web PubSub, ADR 0008)
- `POST /v1/live/token` returns a client access URL that identifies the user (`userId` = `app_user.id`) and grants **no** group-join roles. It is valid for 60 min, and the client refreshes it. Because the token carries no scope, its lifetime doesn't affect what the user can see.
- **Joining is done on the server.** After connecting, the client calls `POST /v1/live/subscriptions { connectionId, projectIds[] }` (and `DELETE` to leave). For each project the API checks `project.read` and the user's project scope. Out-of-scope ids are dropped silently, so their existence isn't revealed. Then the server SDK adds the connection to `project:{id}`. The `portfolio` group is open to every signed-in user, and `admins` only to users with `admin.integrations`. The API must confirm that the `connectionId` belongs to the calling user before adding it; how is settled in S4-02 with the security-reviewer.
- **Revocation is immediate.** When an admin change in Nexus affects a user or a project (`project_access`, `group_role`, `user_role`, user deactivated), the API closes the live connections of the affected users, or of the affected `project:{id}` group. The clients reconnect and re-subscribe through the scope check (R-03, R-60). Changes to Entra group membership take effect with the user's next access token, the same as REST.
- Messages carry ids and values only, never anything outside the group's project. **Nothing project-specific is ever published to `portfolio`.** Only `sync.status` goes there, and a test enforces this.

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
