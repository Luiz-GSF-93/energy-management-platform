# Trading Hub and explicit unit fee basis — BETA 20261116.2

Quotations collect desired annual prices and separate upward/downward flexibility, seasonality, correction index and billing terms. Drafts remain editable without full references; dispatch requires every supply-year reference. One reference covers each consecutive block of at most twelve supply months, labelled by its starting year. Existing financial comparison bases remain separate.

Supplier questions have an explicit urgency (normal, priority, urgent), a bounded inbox and audited, idempotent replies. Backoffice replies queue an individual OTP-protected email link. Selecting an approved proposal offers an explicit thank-you preview and confirmation for other eligible respondents. A provider acknowledgement means accepted, not delivered. An uncertain send is never retried automatically. Received attachments remain scoped and visible in the received list.

The new **Visão do cliente** tab shows exactly the public dashboard projection. Activation queues an individual link to the customer's registered email, scoped to one organization, customer and quotation. The link never outlives the round. It requires an emailed OTP, has a session of at most one hour, can be revoked, and exposes no approval, purchase or mutation actions. Existing client approval and supplier formalization links remain separate.

The client dashboard refreshes every thirty seconds only while visible/online. It shows invitation counts, current comparable proposals, price-revision history, published monthly PLD, sources/dates, and deterministic EVA observations without additional OCR/LLM calls. Rankings and the explicitly explained 0–100 nominal price index require matching declared comparison fields. Incomplete/different terms receive no index. PLD is a historical liquidation reference: a future supply offer is not presented as directly equivalent or guaranteed attractive. Stale/missing PLD is identified and is never replaced by zero.

The countdown uses server time plus monotonic elapsed time. The round deadline and earlier link expiry are distinct. Countdown ticks update their own component, not the whole chart. At link expiry, the client view is cleared; every server read also checks licence, round, customer contact, revocation and session. No raw token/session is persisted in browser storage or a URL query string. Tokens are delivered in fragments, removed from the address bar, and hashed in storage.

The Owner stability projection also recognizes already approved and published historical intakes through the existing strict completion proof. Their original uncertain receipts remain immutable; verified publications are excluded from actionable technical counts. The proof batch is bounded to 100 per organization, and unmatched records continue to require attention.

## Monthly fee basis

Existing immutable monthly fee rules keep `CONSOLIDATED` as their default. A manager/administrator can explicitly register `PER_UNIT` for a hybrid contract and competence. It applies the existing contractual percentage independently to each unit's positive savings before fees, rounds each unit to cents, then sums. Negative savings in another unit do not offset that base. No allocation percentages are accepted in this mode. The fixed fee per unit and contractual percentage are preserved. Corrections create a new monthly rule version, preserving the previous rule and its source. This change does not approve or publish closings.

## Rollout and rollback

1. Apply migrations 20261325–20261329 in order. These extend the schema without changing existing financial or commercial records. Verify marker functions, RLS and grants. Never rerun original creation migrations on production.
2. Publish compatible API, existing EVA worker and frontend. Keep the existing worker; no new OCR consumer or broker is added.
3. Enable `TRADING_COMMUNICATIONS_ENABLED=true` and `TRADING_CLIENT_MONITOR_ENABLED=true` on the API after schema availability. Delivery uses the existing scheduled worker and configured transactional email sender. Set the separately approved quotation-notice limits `TRADING_QUOTE_MAIL_MAX_DAILY=50` and `TRADING_QUOTE_MAIL_MONTHLY_BUDGET_MICRO_USD=5000000`; preserve the existing conservative `PORTAL_NOTIFICATION_EMAIL_COST_MICRO_USD=10000`. These limits are checked per organization; they do not raise the existing SMS/WhatsApp or legacy portal limits. OTP requests retain their separate per-link protections. This is an internal notice-queue budget, not a provider account spending cap.
4. Enable `TRADING_QUOTATION_TERMS_REQUIRED=true` only after the updated frontend/API are available. Old drafts then require completion before sending; existing invitations keep their normal expiry.
5. Verify the public OTP screen without sending real invitations during tests; verify scoped preview and countdown. A real client email is sent only on explicit backoffice activation. Activate the unit fee basis only for confirmed contracts/competences.
6. Rollback: disable the three flags and roll back application code. Preserve additive schema, immutable histories and uncertain delivery receipts. Do not remove already issued per-unit fee rules or recompute them with the old consolidated engine: pause those closings until compatible code is restored. Revocation remains available with compatible code.

## Migration plan status

A: restored access/compatible processing must remain monitored. B: representative 24–72h runtime/SLO measurement remains required. C: use the existing durable asynchronous preparation protocol. D: monitoring infrastructure/native Owner dashboard is separate from this business dashboard; notification checks remain required. E: Trading mail outboxes do not complete the planned EVA stage outbox/broker migration. F: isolated database, scope, expiry, replay and fee tests complement but do not replace representative load/fault tests. G: no claim of BETA exit or zero failures.
