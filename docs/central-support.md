# Atendimento Central

Organization backoffice header → `/backoffice/support`. Internal admin_org, gestor and operacional memberships only; fresh database membership, role ownership, user and license checks. The authorization code shares this ticket with platform support and does not grant organization-operation access.

## Configuration

Apply `20261240_central_support.sql` before enabling the worker. Six RLS-protected private structures, no direct browser or service-role table grants; narrowly granted RPCs enforce tenant/actor boundaries.

Platform plan catalog → expand “Atendimento Central · franquia e tarifa por plano”. Configure included annual tickets and extra ticket amount. Every change has a policy revision and audit entry. Existing annual cycles retain their policy; changes apply to a new cycle. Initial rollout uses the license activation form in platform support and is restricted to `org_default` (Expert Energy).

Human approved configuration on 2026-10-29: Expert Energy plan = **60 tickets per 12 months**, fixed extra = **BRL 25.00**. Apply only after confirming the effective license and its catalog plan. No default values or fees for other plans.

Server environment:

- `CENTRAL_SUPPORT_CODE_SECRET`: server-only random secret, at least 32 characters, never a frontend variable. Eight-digit codes are stored as HMAC hashes bound to organization and immutable draft ID; ten-minute expiry, five attempts, one-minute reauthorization delay. No code plaintext in audit or emails.
- `CENTRAL_SUPPORT_EMAIL_ENABLED=true`: activates the Resend outbox worker and integration with organization operation notifications after migration/configuration verification.
- Existing `RESEND_API_KEY` and `MEMBERSHIP_EMAIL_FROM` are reused. No new provider account or paid AI calls.

## Workflow

1. Requester saves immutable subject/description. Up to 20 pending drafts per requester; no quota consumption.
2. Organization administrator reviews content, privacy and server-calculated exact cost; authorizes and receives a single-use code. An administrator can authorize their own ticket. For another requester, the code is shared by the administrator with that requester.
3. Code submission atomically checks fresh administrator status, cycle, quota and price, records consent and consumes exactly one ticket. Concurrent use of the last free slot never silently turns a free authorization into a paid one. Repeated submission returns the same protocol.
4. Platform support → “Atendimento Central · chamados das organizações”. Manager sets the active support assignee, deadline and public reply. Requests before triage remain separate from existing internal cases. Once triaged, the case is linked to the existing platform support workflow, with organization requester preserved.
5. In-app notifications go to requester and organization administrators. Email goes only to current active internal administrators of the same organization, with protocol, status/deadline, cycle, allowance, used/remaining/extras and accepted cost. Confidential details stay behind authentication.

Only an explicitly public reply is sent back to the organization. Internal support reasons are not copied into public messages. Updates to the existing case’s deadline/status generate notices while preserving internal history.

## Cycles and financial limits

Twelve calendar months from license start, retaining the original anchor across subsequent license records; no carry-over. The server checks the anniversary at every operation, so renewal of the allowance does not depend on a browser tab. An inactive license cannot open a new request. Renewing the allowance does not renew the commercial license.

Extra tickets create one immutable-price billable reference per protocol, initially `PENDING_INVOICE`. This is **not** confirmation of invoice issuance or payment. The inspected Asaas integration is sandbox-only: production invoice linkage/issuance remains gated on a separately homologated destination and exact financial action. No sandbox charge is represented as a real invoice. No real charges are issued in implementation tests.

## Email safety

Outbox lease, stable Resend idempotency key and provider receipt. ACCEPTED means provider acceptance, not delivery. Transport ambiguity or abandoned lease becomes UNKNOWN; no blind resend. Managers can request an audited retry, at most three attempts and only within 23 hours of the initial event, preserving the provider idempotency key. Later ambiguity requires provider reconciliation. Missing administrators/configuration is visible as a communication failure, without duplicating the ticket or quota consumption.

## Verification

`backend`: Jest platform-workflows suite; `node test/database/central-support.test.mjs` runs actual PostgreSQL-compatible functions, including the existing platform support permission/assignment functions. Covers tenant isolation, revoked users, code expiry/attempts, idempotence, quota races, policy snapshots, annual rollover/leap anchor, private table/API grants, support assignment and email retry limits.

`frontend`: `node test/central-support.cjs` exercises the real React component in DOM, exact paid consent, code, errors and completed submission. Compile both applications and run `.github/workflows/central-support.yml` before publishing.

No real support tickets, quota consumption, customer emails, invoice issuance or payment during automated tests. Record deployment and live read-only verification separately.
