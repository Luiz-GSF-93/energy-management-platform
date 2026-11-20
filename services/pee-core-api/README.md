# EnergyOS – PEE / project platform 0.7.0

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

`npm test`: service tests (Core bridge, security, disabled mode, engineering/RCB, escaped deterministic reports, Supabase server key handling and legacy licensing-reference policy). Private release fixtures additionally exercise PostgreSQL RLS, quotas, revisions, signature/submission restrictions and HTTP persistence using a disposable PGlite database. Fixtures never connect to production. Production verification must additionally confirm the dedicated schema, Core current grant, app bootstrap and upload/report flow.

## Commercial release and identity

The independent licensing implementation is separate from internal Core permissions. It requires private Core migration 102 and dedicated PEE migrations 006, 007 and 008, in order. Keep PEE_LICENSING_ENABLED=false until both services, RPC permissions and identity/email configuration have been reviewed and verified together. Installation does not grant any person access or send a contract. Existing Core access remains governed by its individual permission and quota.

An external license requires reviewed parties/conditions, an archived production-provider signature, financial-condition confirmation, explicit Owner release and an individually approved member. Supabase identity is confirmed by the server; an identity alone never grants project access. Tokens remain in purpose-bound encrypted HttpOnly cookies. Current Core entitlement is checked on each request. The fixed internal tenant cannot be used by external licenses. After expiry/suspension, approved users retain only their license-management page so an authorized manager can request cancellation; project APIs remain blocked.

External terms are twelve calendar months from activation with automatic annual renewal and positive official IPCA adjustment. A signed amendment preserves the running anniversary and any cancellation request. Contract revisions queue an editable notice; a royalty increase or decrease requires confirmed principal-recipient delivery, thirty days, new signatures and explicit release. Issued projects retain their original contractual rate. Cancellation stops the next renewal and preserves outstanding amounts and royalties on already-approved projects or pending projects approved later. Recording a settlement never moves money or marks a bank invoice paid.

Contractual emails use the same bounded PEE Resend queue as project messages. The principal recipient is checked before delivery can start the thirty-day period. The licensor address is Reply-To, not a delivery-proving copy. Account-wide mail unrelated to PEE is never fetched. Ambiguous sends retain a stable provider idempotency identity and require reconciliation.

PEE_EVA_AI_ENABLED optionally enables asynchronous field assistance through the private Core connector and its existing Azure provider. Only selected public official-source excerpts and the field question are sent; project files and business records are excluded. Core rechecks the identity for start and result polling, bounds concurrency/requests, validates citations and performs no actions. Missing evidence and provider failures remain explicit. The deterministic normative engine and approved normative page are unchanged.

Project reports support HTML, native branded PDF and a ten-sheet XLSX conference export from the same server calculations. Text is stored as text in XLSX, not executable formulas or external links. ZIP packages preserve originals, signed documents and evidence separately and include export hashes. These platform exports do not replace a distributor's own edital-specific forms or constitute a signature, protocol or approval.

The custom domain must have valid TLS before changing the fixed origin in Core and PEE together. PEE_CANONICAL_REDIRECT_ENABLED redirects browser entry points from the legacy host to the configured origin, without forwarding authentication query values. Machine health/connector/webhook paths remain stable. Keep exactly one PEE replica while the bounded connector queue is in memory. Model jobs are short-lived suggestions and fail closed on restart.

Official technical references: https://supabase.com/docs/guides/database/postgres/row-level-security ; https://supabase.com/kb/troubleshooting/cant-revoke-a-role-membership-granted-by-supabase_admin-d08922 ; https://supabase.com/docs/guides/storage/security/access-control . PEE call rules: https://www.gov.br/aneel/pt-br/assuntos/programa-de-eficiencia-energetica/chamadas-publicas .

## Reviewed normative evaluation

The supplied ANEEL CPP guide is the 2016 edition (72 PDF pages). It is a historical reference, not an automatic source of current edital weights or deadlines. The deterministic engine recalculates eligibility checks, total/PEE RCB, resource funding, quality evidence and action plans from stored project data. Competitive scores require reviewed current-edital methods and, for relative methods, a documented same-call and same-typology reference. No approval probability is invented.

Version 002 must be applied to the dedicated PEE database before enabling the new workspace revision. It repairs reviewer persistence within the already authorized role, provides actual quota usage, atomic project snapshots and stale-snapshot emission protection. It does not grant direct table access to browsers.

Session renewal is explicitly controlled by PEE_ACTIVITY_ENABLED. Real input renews the 15-minute idle window through Core; reads and timer-only polling do not. Core revocation, grant expiry and absolute session policy remain authoritative.

The full approved 22-module rollout remains under implementation. Do not treat a menu item, draft contract or configured provider as evidence of an active paid license or a delivered message. No existing EnergyOS source is imported or changed by this service.


## Private project communications (schema 004/005)

The existing Resend account is shared. Use only a dedicated PEE key and webhook, kept in Railway secret variables. Full-access receiving credentials technically span the account: the application checks the signed event recipient against a registered opaque PEE reply address before requesting any message body. Unrelated mail is ignored. User operations enforce BOTH tenant and mailbox owner, including inside one workspace. No message body, recipient or CC/BCC list is copied to the workspace audit.

Configure PEE_RESEND_ENABLED, PEE_RESEND_API_KEY, PEE_RESEND_WEBHOOK_SECRET, PEE_MAIL_FROM and PEE_MAIL_RECEIVING_DOMAIN only after both migrations. The webhook is POST /webhooks/resend and requires Svix authentication of the original raw body. Subscribe to email.received, email.sent, email.delivered, email.delivery_delayed, email.bounced, email.complained, email.failed and email.suppressed. Provider calls are fixed-path HTTPS, bounded to two starts/second with a bounded queue and Retry-After cooldown. No automatic network replay is performed. The existing account plan and capacity remain shared with other applications.

Sending requires an explicitly reviewed server-generated preview, unchanged project snapshot, recipients/copies confirmation and attachment integrity. Up to 20 files and 20 MB total originals are supported per message. Stable provider idempotency keys protect uncertain sends for a 23-hour retry window. Incoming attachments are archived privately from the fixed Resend CDN, with public DNS pinning, size checks and integrity-checked downloads. Received messages are inert text; provider acceptance and delivery never imply a distributor protocol or approval.

## Signatures and project package

GOV.BR and ITI are official external user-operated portals; this private platform does not claim an authorized government signing API or automated ITI certification. A user can invoke the documented local Assinador SERPRO WebSocket for a PDF, explicitly choose their installed certificate and confirm locally. No private key, PFX or PIN enters the platform. Original, signed PDF (or manual-linking signed declaration) and validation evidence remain distinct private documents. Only an authorized reviewer can register a human check of matching evidence hashes and the ITI/notarization result.

A review ZIP preserves all private originals, the final HTML report and a SHA-256 integrity manifest. A presentation ZIP is blocked while the approved evaluation engine reports issues; successful presentation issuance uses atomic monthly quota and snapshot guards. Package generation does not send a project or register an official submission. The approved normative UI and calculation engine remain unchanged.


## Client portal, commercial automation and protected exports (0.8)

Apply dedicated PEE schemas 009–012 in order, then the reviewed private Core migrations 105/106 and least-privilege grants. Deploy with all four new flags disabled, verify compatible Core/PEE versions, then explicitly enable only the reviewed functions. This service never changes the existing EnergyOS database or source.

Personal client invitations expire after seven days and are single-use. Sessions expire after fifteen minutes without trusted activity. An expired session can request a fresh fifteen-minute single-use link sent only to the invitation's registered email, with rate limits and revocation checks. Assigned fields and document requests remain project-scoped. Original PDF, returned signed PDF and ITI validation PDF are distinct evidence. Human reviewer verification is mandatory; uploads alone do not prove a signature. Accepted requests feed the existing requirement answers and approved evaluation engine without changing its code or normative UI.

Content protection denies raw exports of signed/validated documents and their evidence even to managers. Authenticated page consultation renders bounded PNGs through Poppler; it does not expose the original PDF route. Browser focus masking, print styling and copy-command blocking are deterrents, not an operating-system screen-capture or screen-sharing guarantee. The final report contains only the requested document-control footer, not a content watermark. Emitted documents retain an emission reference, version, template version, snapshot digest, page numbers, glossary and calculation formulas.

Final submission sends attachments only to the reviewed distributor addresses. Purchaser and sender receive separate notices with authenticated private links and no attachments. Schema 012 outbox acceptance is distinct from confirmed distributor delivery. Unknown sends require reconciliation; a second notice is not automatically sent after an ambiguous provider outcome. SMTP acceptance is not a distributor protocol or project approval.

Private Core commercialization owns proposal/Clicksign/payment/release decisions. The optional offer flow requires legally reviewed terms, approved member, production-homologated Clicksign and explicit Owner preapproval. Initial automatic activation additionally requires verified signed contract and reconciled first payment; otherwise release stays manual. Inter boletos are created by the existing Core finance workflow and linked by exact payer CNPJ and authorized unit; no new bank charge is created by linking. Existing collection delivery/reminders send the official boleto. Grace is three calendar days after due date; day four blocks technical access until reconciliation. Account/cancellation access remains available subject to identity and permissions. Card payments are deferred.

The welcome outbox creates a random provisional password only for a new external identity, keeps it in memory, sends through the configured server mail provider, and requires replacement before projects. Existing identities are never reset. Verified authenticator factors require the provider's AAL2 session. No password, TOTP secret, private key or PIN is written to audit or Core records.
