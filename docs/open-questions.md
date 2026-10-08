# Open questions

Agents: when a requirement depends on one of these, build the part that doesn't depend on the answer, show the field as "not available yet", and link the question number in the PR. Never guess the answer.

| # | Question | For | Blocks | Status |
|---|---|---|---|---|
| Q1 | Updated DATOMS API docs for sites/territories (with coordinates, state, district), asset → site link, asset location, asset type, asset status, events/notifications, history, parameter metadata (names, units). | DATOMS | R-10, R-11, R-21, R-23, R-40, R-32 backfill | Open. DATOMS confirmed "everything in the portal is available by API". |
| Q2 | Is the project state (Active / Central Store / Finished / In bid) held in DATOMS? If not, an admin sets it in Nexus. | Innovo / DATOMS | R-11 | Open |
| Q3 | Does DATOMS hold DG ownership (Owned / Hired) and energy site totals (load, solar, mains ratio)? | DATOMS | R-25, R-31 | Open |
| Q4 | Does Innovo have an ArcGIS Online or ArcGIS Enterprise organisation (for SSO and licensing), or should we use an ArcGIS Location Platform API key? | Innovo IT | 09-map-arcgis auth | Open |
| Q5 | Monthly DATOMS credit allowance for the subscribed tier, so it can be set as `DATOMS_MONTHLY_CREDIT_ALLOWANCE`. | Innovo (business owner) | Budget tracker config | Open |
| Q6 | Does DATOMS offer streaming (WebSocket / MQTT) or webhooks for changes under 60 s? | DATOMS | ADR 0004 | Open |
| Q7 | A DATOMS test organisation or credential for dev/test environments? | DATOMS | dev env, contract tests | Open |
| Q8 | The DATOMS rule for when an asset counts as offline / stale, so Nexus shows stale exactly as DATOMS does. | DATOMS | R-27 | Open |
