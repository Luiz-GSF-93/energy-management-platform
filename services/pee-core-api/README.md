# EnergyOS – PEE / project platform 0.6.0

Independent service. No existing EnergyOS entrypoint imports it. Keep the existing EnergyOS services and main branch unchanged.

## Runtime modes

- `PEE_ACCESS_ENABLED=true`: browser-bound Core SSO with PKCE, encrypted HttpOnly cookies, current permission checks and fixed Expert Energy tenant.
- `PEE_PROJECTS_ENABLED=true`: authenticated persistent project workspace. Requires the dedicated PEE Supabase URL and server-only key.
- `PEE_CORE_ENABLED=false`: MUST remain false. The old reference RS256 licensing gateway is incompatible with the opaque Core session bridge.

The project workspace provides beneficiaries, consumer units, detailed projects, all nine use-final simulations, selected-measure RCB consolidation, private documents, signature evidence/review, call-specific requirements, document templates, reviewed process transitions and immutable audit. There are no demo identities or seeded customers in production. Public `/commercial` contains the narrated animation and explanatory presentation. Platform templates and exploratory RCB estimates do not replace official call forms, calculation methods or professional review.

## Dedicated persistence

`production-schema.sql` is exclusively for the dedicated PEE project, never the existing EnergyOS database. It creates the tables and private `pee-private` storage bucket. The custom NOLOGIN/NOBYPASSRLS function owner has forced tenant policies. Anonymous/authenticated browser roles cannot execute `pee_store`. Even the service HTTP role has no direct table privileges; the server invokes the controlled RPC. A short temporary role membership is used solely to assign the function owner, then revoked, following the Supabase documented ownership model.

`SUPABASE_URL` and `SUPABASE_SERVER_KEY` are Railway service variables only. Never include real keys in Git, client scripts, artifacts, logs or URLs. The browser receives the permitted workspace data and a CSRF token, never provider/Core credentials. Private downloads recheck access and integrity; files are served as attachments.

## Identity and quotas

Each operation introspects the Core session. Core users cannot select a third-party tenant or gain access because they are administrators. Reviewer and editor duties are separate. Quotas are consumed atomically on the server for distinct final-dossier projects per month, using the current Core limit; reissues of the same project in the month do not double count. Request IDs are content-bound and idempotent. Original files and SHA-256 are preserved. A claimed signature is not automatically verified: the authorized reviewer must attach and confer evidence.

Exactly one Railway replica and one outbound Core connector remain required; transport and per-user request limits are process-local until shared coordination is implemented. Do not increase replicas without that change.

## Validation

`npm test`: 19 service tests (Core bridge, security, disabled mode, engineering/RCB, escaped deterministic reports, Supabase server key handling and legacy licensing-reference policy). Private release fixtures additionally exercise PostgreSQL RLS, quotas, revisions, signature/submission restrictions and HTTP persistence using a disposable PGlite database. Fixtures never connect to production. Production verification must additionally confirm the dedicated schema, Core current grant, app bootstrap and upload/report flow.

## Business integrations still separate

The standalone license reference is not the real sales module. The Core commercial module, independent licensed-user identity, live provider signature jobs, royalties ledger, official-source EVA and email dispatch must be implemented and homologated separately before their capability flags are enabled. Health reports these capabilities explicitly; a ready project workspace is not a declaration that those commercial integrations are complete. No email is sent, contract signed, charge made or distributor project submitted by installing this service.

Official technical references: https://supabase.com/docs/guides/database/postgres/row-level-security ; https://supabase.com/kb/troubleshooting/cant-revoke-a-role-membership-granted-by-supabase_admin-d08922 ; https://supabase.com/docs/guides/storage/security/access-control . PEE call rules: https://www.gov.br/aneel/pt-br/assuntos/programa-de-eficiencia-energetica/chamadas-publicas .
