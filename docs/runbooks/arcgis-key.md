# Runbook: the ArcGIS API key

Who: a person with rights on Innovo's ArcGIS account (ArcGIS Location Platform or ArcGIS Online) and on the Azure Key Vault. Related: `docs/09-map-arcgis.md` section 1, `docs/08-auth-and-access.md` section 6, `docs/04-tech-stack.md` (environment variables), open questions Q4 and Q23.

Rules that apply to every step:

- **Never** paste the key into chat, a PR, an issue, a log, a URL or a commit. Do not write it in this file.
- There is **one key per environment** (dev, prod). Do not reuse a key across environments.
- The key reaches the browser only as the response of `GET /v1/config` (signed-in users). It is not in the web build.

## 1. Create the key

1. Sign in to the ArcGIS portal that owns the account (Q4 decides which one).
2. Open Content, then New item, then Developer credentials, then API key credentials.
3. Name it `nexus-<environment>-<yyyy-mm>` (for example the environment and the month of creation).
4. Set the privileges to the minimum Nexus needs:
   - Location services: **Basemaps** (static basemap tiles).
   - Location services: **Elevation** (world elevation for 3D).
   - 3D content: only if the 3D buildings layer in `components/map/arcgis/settings.ts` needs it.
   - Nothing else. No geocoding, routing, storage or portal privileges.
5. Set the expiry to **90 days** from today.
6. Create the credential and copy the key straight into the next step. Do not keep it anywhere else.

## 2. Restrict it by referrer, and keep the privileges minimal
**The privileges are the real control.** A referrer restriction can be spoofed by anyone who calls ArcGIS directly with the key, so assume the key is public and give it only what Nexus needs (step 1.4).

1. Open the credential, then Referrers.
2. Add only the Nexus origins for that environment:
   - dev: the dev Static Web App host (`https://<dev-swa-host>/*`).
   - prod: the production host only.
   - **Environment keys never include `localhost`.** Developers use their own key limited to `http://localhost:5173/*` (section 4).
3. Save. Check that the list has no wildcard host (`*`) and no other site.
4. Set a **usage alert or a spending cap** on the credential (ArcGIS usage dashboard, then alerts or the credit limit), so a leaked key cannot run up cost unnoticed. Do this for every key, including developer keys.

## 3. Store it in Key Vault

1. Open the environment's Key Vault (`docs/sprints/S0.md` S0-02) and add the secret `arcgis-api-key`.
2. Paste the key as the value. Set the expiry date to the same 90 days.
3. Confirm that only the API's managed identity can read it (`Key Vault Secrets User`). The worker and the web app do not need it.
4. The API reads it as `ARCGIS_API_KEY` and serves it in `GET /v1/config`. Nothing else uses it.
5. Clear your clipboard.

## 4. Local development (until S1-02 serves `/v1/config`)

1. Create a separate key for yourself with the same privileges, restricted to `http://localhost:5173/*` only.
2. Put it in your git-ignored `.env` as `VITE_DEV_ARCGIS_API_KEY`. Never set it in CI or Azure: `pnpm build` fails when it is set.
3. The MSW mock reads it in Vite dev mode only. Without it the map shows "Map key not configured".
4. Remove the variable and this section when S1-02 is live.

## 5. Rotate every 90 days

1. Calendar a reminder 14 days before the expiry on the Key Vault secret.
2. Create a **new** key (steps 1 and 2). Do not edit the old one.
3. Add the new key as a **new version** of `arcgis-api-key` in Key Vault.
4. Restart the API (new revision) so it reads the new version. Ask a signed-in user to reload the site; the browser gets the new key from `/v1/config`.
5. Check the map on the environment (2D, satellite, 3D) and the ArcGIS usage dashboard for errors on the new key.
6. Delete the old credential in ArcGIS. Disable the old Key Vault version.
7. Record the rotation date (not the key) in the team's log.

## 6. If a key leaks

1. Delete the credential in ArcGIS now. The map stops until the new key is live.
2. Do steps 1 to 3 for a new key and restart the API.
3. Check the ArcGIS usage dashboard for requests you do not recognise.
4. If it was committed, tell the Nexus lead. Removing it from git history does not make it safe again; the old key must stay deleted.

## 7. Deploy note (S0-07)
The deploy job must build the web app with `pnpm --filter @nexus/web build`. That build runs the checks in `apps/web/plugins/checkDist.ts` (no key, no MSW, no sample data, no ArcGIS chunk on first load, source maps included) and refuses `NODE_ENV=development`, a `VITE_DEV_ARCGIS_API_KEY` value and any `VITE_` name outside the allow-list. A job that runs `vite build` directly gets the same checks, but the package script sets the Node heap size the ArcGIS bundle needs. `VITE_API_BASE_URL` must be an https URL.

## 8. Check it works

- `GET /v1/config` as a signed-in user returns a non-empty `arcgis.apiKey` (do not paste the value anywhere).
- The Portfolio and project maps draw basemap tiles. In 3D, the elevation and buildings load.
- With the key removed from Key Vault, the map shows "Map key not configured" and the project list still works.
- A request from a site that is not in the referrer list is refused by ArcGIS.
