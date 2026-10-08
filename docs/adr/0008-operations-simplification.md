# 0008 · Operations simplification for a two-person team

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** Ahmed (architecture review 1, concerns 6, 7 and 9)

## Context
Two developers run everything. Ahmed owns api, worker, datoms-client, db, infra, CI/CD, Entra and security. The frontend colleague owns the whole web app, including ArcGIS 2D, satellite and 3D. The phase 1 design had:
- four environments (local, dev, test, prod), plus Bicep for three cloud ones;
- a Microsoft Graph fallback for Entra group overage, which needs an app secret or identity with `GroupMember.Read.All` and admin consent;
- optional Front Door + WAF and a Blob/Parquet archive job;
- a full-featured 3D asset layer (callouts, pulse);
- Web PubSub messages carrying every changed value. These are about 0.5 MB per message for a 250-asset site and would hit the 1 MB message limit at about 500 assets.
- Web PubSub tokens valid for 60 minutes with per-project join roles. A user whose access was removed could keep receiving live data, which breaks R-03 and R-60.

## Decision
1. **Groups claim: "groups assigned to the application"** on `nexus-api`. Users can sign in only through assigned groups ("Assignment required = yes"), so every group Nexus uses is assigned to the app anyway. The token then contains only those groups, which makes the 200-group overage path and Microsoft Graph unnecessary. The Graph secret, the `GroupMember.Read.All` permission and the `ENTRA_GRAPH_CLIENT_SECRET` variable are removed. Users must be **direct** members of an assigned group. Innovo IT confirms licensing and nested-group behaviour (Q16).
2. **Two cloud environments: dev and prod.** The `test` environment is dropped. The pilot (S9) runs in prod, with only pilot users assigned to the Entra app. Dev uses fixtures or a small id-mode subset (ADR 0005).
3. **Deferred:** Azure Front Door + WAF and the Blob/Parquet archive job (`archive.enabled` stays `false`). Both come back only when there is a decision: Q20 for network exposure, Q15 for the archive. Raw retention stays 90 days until Q15 is answered.
4. **Simple 3D:** the 3D view uses the same asset-type icons as 2D (`IconSymbol3DLayer`), with no callouts or vertical offsets and no pulse animation. 2D keeps the pulse on status change (R-21, Q19 open).
5. **Keep Web PubSub**, with two changes:
   - **Slim messages.** Project groups receive only status and location changes, box figures (`summary.updated`) and a small `values.updated` hint. An open asset panel or device card refetches `GET /v1/assets/{id}` when the hint arrives. `GET /projects/{id}/assets` no longer returns `latestValues`. Messages are chunked so that each stays well under 1 MB (`10-api-design.md`).
   - **Server-side subscriptions.** `POST /v1/live/token` returns a token with **no** group-join roles. The client asks to join through `POST /v1/live/subscriptions`, which checks permission and project scope and then adds the connection to `project:{id}` on the server. When an access change in Nexus affects a project or user, the API closes the affected live connections. Clients reconnect and re-subscribe through the scope check, so revocation takes effect at once (R-03, R-60).
   - `LIVE_MODE=poll` (60 s API refetch) stays as the fallback.

## Options considered
| Option | Pros | Cons |
|---|---|---|
| The package above (chosen) | Fewer secrets, environments and moving parts; live push stays within size limits and scope rules | No separate test environment before go-live; 3D is plainer |
| Keep everything as designed | Full separation and features | Too much for two people; live push breaks on large sites; revocation gap |
| Also drop Web PubSub and use API polling only | Even fewer services | Up to 2 minutes behind; more API load; push would have to be added back later |

## Consequences
- `03` §6, `04` (environment variables, platform), `05` (workflows, infra env files), `08` §1 and §4, `09` §4, `10` and `11` are updated.
- Backlog S0-04, S4-02 and S9-02 change (see `docs/source/backlog.md`).
- Risk: there is no pre-prod environment with live data. This is mitigated by fixture replay in dev, contract tests and the pilot being limited to pilot users.
- To reverse: add a `test.bicepparam` and a workflow, or turn on Front Door or archiving by setting, each with its own ADR when the trigger arrives.
