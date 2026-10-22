# 08 · Authentication and access control

## 1. Entra ID setup (S0-04)
| App registration | Type | Settings |
|---|---|---|
| `nexus-api` | Web API | Exposes scope `api://nexus-api/access_as_user`. Token v2. Includes the `groups` claim set to **"groups assigned to the application"** (ADR 0008), so the token lists only the Nexus groups. |
| `nexus-web` | SPA | Redirect URIs per environment. Auth code + PKCE. Asks for `api://nexus-api/access_as_user`, `openid`, `profile`, `offline_access`. |
| `nexus-worker` | (none) | Uses a managed identity for Key Vault and Postgres; never signs in as a user |
| `nexus-reporting` (later) | Service principal | Client credentials, app role `Reporting.Read` |

- Single tenant (the Innovo tenant only). Assignment required = yes, so only assigned users and groups can sign in at all. S0-04 must set this on the `nexus-api` enterprise app as well as `nexus-web`; the API also refuses tokens whose `azp` is not `ENTRA_WEB_CLIENT_ID`.
- Entra security groups (suggested): `Nexus-Admins`, `Nexus-Leadership`, `Nexus-ProjectManagers`, `Nexus-SiteUsers`, `Nexus-Viewers`, plus per-project groups if Innovo wants them (e.g. `Nexus-Project-GHAFWOODS`). The final role list is open question Q17.
- **Groups claim (ADR 0008):** `nexus-api` emits only the groups **assigned to the enterprise application**. Every group used in `access.group_role` or `access.project_access` must be assigned to the app; the admin screen warns when a mapped group is not in any token it has seen. Users must be **direct** members of an assigned group. Group-based assignment needs Entra ID P1 or higher (Q16 asks Innovo IT to confirm the licence and the nested-group behaviour).
- **No group overage path:** because the claim lists only the few assigned groups, the 200-group overage case doesn't arise, and Nexus does **not** call Microsoft Graph (no `GroupMember.Read.All`, no Graph secret). If a token ever arrives with an overage marker instead of `groups`, the API refuses with 403 and logs it for an admin.

## 2. Request flow in the API
1. **EntraJwtGuard** (global). It validates the signature against the tenant JWKS (cached), plus `iss`, `aud = api://nexus-api`, `exp`/`nbf`, `tid = Innovo tenant` and `scp` contains `access_as_user`.
   - Built in S1-02 (`apps/api/src/common/auth/`): the JWKS URL comes from config (`ENTRA_JWKS_URL`, default derived from the tenant id; an override is accepted only when `APP_ENV=local`). Keys are cached for 6 h and an unknown `kid` triggers a refetch. A bad or expired token gives 401, a valid token without `access_as_user` gives 403, an unreachable JWKS gives 503. `exp`/`nbf` allow 30 s of clock skew. `aud` may be the identifier URI or the API client id until S0-04 confirms the real token, then only that one is accepted (Q29). `AUTH_MODE=dev` is accepted only with `APP_ENV=local` and is not implemented yet. The user, role and scope lookup sits behind the `AccessDirectory` interface: `PostgresAccessDirectory` in the API (S1-01, done), an in-memory one in tests.
2. **Load the user.** Upsert `access.app_user` by `oid` (name, email, last_seen_at). An inactive user gets 403. Users are matched by `oid` only; email is never used for authorisation.
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
   - `ProjectScopeGuard` is a global guard (third, after the permission guard): every route with a `:projectId` parameter gets 404 if the id is not a UUID or the project is not in scope. Nothing opts in. The decorators in step 4 are method-level only; access metadata on a controller class is refused. It is 404, not 403, so it doesn't reveal that the project exists.
   - List and search queries go through `withProjectScope()` in the repository.
   - Asset or event routes look up the project of the asset or event first, then check scope.
6. **Audit.** Sign-in, admin changes and CSV exports are written to `audit.log`. **Sign-in rule (S1-01, done):** a bearer-token API has no session, so a sign-in (`auth.sign_in`, with user, IP, user agent and the request's correlation id) is recorded when the access cache misses and the user's previous `last_seen_at` is older than the setting `audit.sign_in_gap_minutes` in `core.setting` (default **60**, read with a 60 s cache). A failed audit write does not block sign-in; it is counted and logged as `event=audit.write_failed` for an alert. A missing next-month `audit.log` partition would cause exactly that, so the maintenance job needs a health alert on partition coverage (not built yet). TODO (Q38): switch to the Entra session id (`sid`) if S0-04 confirms tokens carry it. `request.ip` is the proxy's address until `trustProxy` is set (S1-09).

**Known limits (accepted in the S1-02 security review, 2026-10-12):**
- **No fallback to old JWKS keys.** Keys are cached for 6 h. If the refresh after that fails (Entra down, proxy error), every request gets 503 until a refresh succeeds; the API does not keep using the expired keys.
- **Access cache across API instances (fixed in S1-01).** Database triggers send `NOTIFY nexus_access` when roles, group mappings, project access or the active flag change (also on TRUNCATE); every API instance holds a `LISTEN` connection and clears its cache. A cache **hit re-checks `is_active`** in the database (one primary-key lookup), a load that started before a change is never cached, and the cache is **off** until the listener has proved it hears the database (it sends itself a random value every 15 to 30 s and treats a missing echo within 5 s as lost, which also catches half-open connections). The listener refuses the PgBouncer port 6432. To remove a user, set `is_active = false`; do not delete the row.
- **`AUTH_MODE=dev` gate.** Today it relies only on `APP_ENV=local`. When dev mode is built, the API must also refuse to start if Azure runtime variables are present, Bicep must set `APP_ENV` explicitly, and the dev signing keys stay in memory (never behind `ENTRA_JWKS_URL`).

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
- `GET /v1/me` returns the user, roles, permissions and `projectScope` (`all`, and `projectIds` when not `all`). The UI hides things based on it, but **the API is the real check**.
- Sign-out clears the MSAL cache and the live connection.

## 6. Security baseline
Built in S1-09 (`apps/api/src/common/http/security.ts`, `common/rate-limit/`). Every limit is read from config (`04` environment table).
- **Secure headers:** `@fastify/helmet` on every response, errors and 404s included: `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, HSTS (1 year), `nosniff`, `X-Frame-Options`, `Referrer-Policy: no-referrer`. Only `/docs` (not mounted in prod) gets a looser CSP: its own scripts, styles and images, no inline script.
- **CORS:** only the exact origins in `CORS_ALLOWED_ORIGINS` (https, no wildcard, validated at startup; http is allowed only when `APP_ENV=local`). Any other origin gets no CORS headers. No credentials: the SPA sends a bearer token, not cookies. When nothing is configured outside local, no browser origin is allowed.
- **Rate limit:** two fixed one-minute windows, in memory.
  1. Per user, keyed on the `oid` of the **validated** token: `EntraJwtGuard` counts it right after the token checks and before any database work, so deactivated and abusive users cost no queries and a forged token cannot spend someone else's budget. `RATE_LIMIT_USER_PER_MINUTE`, default 600.
  2. Per client address, in a Fastify `onRequest` hook before routing, body parsing and any guard, so unknown paths, oversized bodies and floods of bad tokens are covered too: `RATE_LIMIT_IP_PER_MINUTE`, default 3000 (high because an office shares one address). This is also the "by IP before sign-in" fallback.
  - Over the limit: 429 problem+json with `Retry-After`.
  - **The counters are per API instance, not shared across replicas:** with N replicas a client can reach N times the limit, and a restart resets them. This guards against runaway clients and is not a security boundary, so no Postgres write is made per request. A shared store is a later change if abuse needs it.
- **Client address:** `TRUST_PROXY` says which proxies sit in front of the API, otherwise the sign-in audit IP and the IP limit see the proxy's address. It is **required when `APP_ENV` is dev or prod** (startup fails without it; `false` is an explicit choice). Accepted: `false`; a **hop count of exactly `1` or `2`**; or a list of proxy IPs/CIDRs. **Rule (Q46, answered 2026-10-19):** use `1` for Azure Container Apps ingress with nothing in front of it, `2` if Front Door or App Gateway is added later, and leave it unset locally. Verify on the first deploy that the audit IP is the real client address. Fastify 5 treats a plain number as "trust nobody", so a hop count is turned into a trust function (the connecting peer and the next N-1 `X-Forwarded-For` entries are proxies; the next one is the client). That is only safe because the ingress is the one way in. Refused: `true`, any other number, IPv4 wider than /8, IPv6 wider than /32, `::ffff:` notation. The address is counted as IPv4 when it is IPv4-mapped, and IPv6 clients by their /64.
- **Body limit:** `BODY_LIMIT_BYTES` (default 1 MiB); larger bodies get 413 problem+json before any handler runs.
- **Swagger UI and the spec:** `/docs` and `/openapi.json` exist only for `APP_ENV` local or dev (404 in prod).
- HTTPS only. The ArcGIS domains belong in the CSP of the **web app** (Static Web Apps headers), not of the JSON API.
- Inputs are validated with zod. SQL goes only through Kysely parameter binding.
- Secrets in Key Vault: DATOMS token, ArcGIS API key (also restricted by HTTP referrer), DB credentials. Rotate them every 90 days (runbook).
- Dependency scanning (Renovate + `pnpm audit` in CI). A penetration test happens before go-live (S8-05).
- Data is held only in Azure UAE North.

## 7. Local development sign-in (`AUTH_MODE=dev`, S1-02)
Lets a developer run the whole app on one machine with no Azure and no Entra. **It is never in any deployed environment.** This is enforced by guards, not by the mode being impossible to start elsewhere (see the list below), and by deployment rules: the API image must not contain `dist/dev`, and infra must set `APP_ENV` to `dev` or `prod` and leave `AUTH_MODE` unset (Q49). A token this mode signs is accepted only by the API process that holds the matching in-memory key.
- **Refused to start** (`loadConfig`, `config/dev-mode-guards.ts`) unless all of these hold: `APP_ENV=local`; the database host is this machine (`localhost`, loopback or a unix socket, read with the same parser `pg` uses: more than one `host`, a host list, `hostaddr` or a non-local `PGHOST` all count as not local; `isLocalHost` in `@nexus/db`); `TRUST_PROXY` is unset or `false`; and none of `CONTAINER_APP_NAME`, `CONTAINER_APP_REPLICA_NAME`, `KUBERNETES_SERVICE_HOST`, `WEBSITE_INSTANCE_ID`, `IDENTITY_ENDPOINT`, `CODESPACES` is set. `AUTH_MODE` is matched exactly (`DEV` or ` dev` is a startup error). **Known limit:** a loopback or unix-socket tunnel to a shared database still looks local; do not point a local `DATABASE_URL` at a tunnel to a shared database. In this mode the `ENTRA_*` values may be unset: fixed fake ids are used. The API listens on `localhost` only.
- **Request checks on every route** (`dev/local-request.hook.ts`, an `onRequest` hook; the token route repeats them): the socket peer (never `request.ip`) is loopback; none of `X-Forwarded-For`, `Forwarded`, `X-Real-IP`, `X-Forwarded-Host` is present; `Host` is `localhost`, `127.0.0.1` or `[::1]`; an `Origin`, when sent, is one of `CORS_ALLOWED_ORIGINS`. This blocks tunnels, local reverse proxies and DNS rebinding, which all arrive from loopback. Otherwise 403.
- **Same validation path.** The API generates an RS256 key pair at startup, **in memory, never written to disk** (a restart invalidates every earlier dev token), and gives `EntraJwtGuard` a key resolver for its public key instead of the Entra JWKS. The guard is unchanged: `iss`, `aud`, `tid`, `azp`, `scp`, `exp`, the `groups` claim, the user upsert and the groups-to-roles mapping in the database all run exactly as for Entra. There is no bypass. A token signed by any other key gets 401.
- **`POST /v1/dev/token`** `{ "user": "admin" }` returns `{ tokenType, accessToken, expiresIn: 3600, user }`. Demo users: `admin`, `leadership`, `project_manager`, `site_user`, `viewer`, each with a fixed `oid` and the fake group GUID of `db/seeds/dev-roles.sql` (so roles come from `access.group_role`). An unknown name is 400. The route is `@Public` (nobody has a token yet), answers only to this machine (the request checks above), is not in `openapi.json`, and its module is loaded with a dynamic `import()` only in this mode: with `AUTH_MODE=entra` the route does not exist (404) and a test proves it. The default-deny test allows `@Public` on `/dev/token` only in dev mode.
- **Web.** `VITE_AUTH_MODE=dev` (Vite dev server only; a production build fails if it is set) shows "Sign in as ..." in the user menu. The token is held **in memory only**; `sessionStorage` keeps only the chosen demo user's key (not the token) so a reload signs in again as the same user; nothing is written to `localStorage`. The name shown comes from `GET /v1/me`. `check-dist` fails the build if any of this code is in `dist/`.
- Run it with `pnpm dev:local` (README "Run locally").
