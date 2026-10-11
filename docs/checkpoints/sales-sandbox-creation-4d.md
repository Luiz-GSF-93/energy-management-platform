# Sales sandbox creation — 4D, delivered disabled

This is an isolated preparation of a first-cycle BOLETO charge from an internally approved proposal and an explicitly approved terms revision. It does not accept a client-supplied price. Currency remains BRL and the source snapshot is preserved.

Both `SALES_ASAAS_CREATION_ENABLED` and `SALES_ASAAS_CREATION_CALLS_ENABLED` default to off and must remain unset/false for this delivery. The first flag enables private preparation/read; the second separately permits external execution/recovery. External calls additionally require the existing sandbox flag, exact sandbox base URL and server-only API key. No job or webhook automatically invokes this capability.

Only an active platform Owner with the existing global Owner permission may use these endpoints. The database revalidates that identity. No permissions are granted by the migration. Finance, support, organizations and the client portal cannot create intentions or execute charges.

Intention creation needs proposal ID, approved terms revision, existing sandbox customer ID, due date within 90 days, documented origin and explicit consent. The payer must already exist and have notifications globally disabled before the adapter will issue a POST. This phase deliberately does not create/update customers or change notifications. External homologation requires a separately approved payer/charge. Do not reuse the existing already-bound Digivolt first cycle: proposals with an existing binding are blocked.

The immutable intention has one unique reservation per proposal/first cycle. Parameters are hashed by PostgreSQL. Identical replay of the original request returns the same intention; changed parameters or a second intention conflict. History is append-only with original actor IDs and recorded names. A missing name remains explicitly absent. If the authorization directory itself is unavailable, access fails closed; the original intention and actor IDs are preserved for recovery.

Execution reserves `DISPATCHING` and its lease before one POST. A timeout, inconsistent response or lost completion never releases that reservation for another POST. Recovery uses only a filtered GET by customer and external reference and requires exactly one matching result. Zero/multiple results remain blocked for review. Interrupted dispatch is recoverable after two minutes; new creation remains prohibited even if no result is found. No automatic retry, refund, subscription, invoice, payment or license provisioning exists here.

A compatible creation response appends `CREATED` and inserts one binding into the existing sandbox tracking flow. This does not confirm payment or activate a license. Payment events continue through the existing authenticated webhook and Owner verification. An interrupted database completion can be recovered by reference without recreating the charge.

The migration is additive: two private RLS tables, immutable triggers and a service-role-only RPC. Existing proposals, licenses, roles, financial records and ingress are unchanged. Reapplication does not assign access or rewrite records.

Validation uses mocked provider responses and a disposable PostgreSQL database only. It covers defaults off, Owner restrictions, unapproved sources, already-bound cycles, parameter replay/conflict, concurrent reservations, immutable records, stale leases, ambiguous completion, recovery without POST, incompatible/multiple results, notifications enabled, host/redirect protections, payload size and secret redaction. External creation, cancellation/refund/overdue, production finance and automatic activation remain unhomologated.

Official references: [create payment](https://docs.asaas.com/reference/criar-nova-cobranca), [payment recovery filters](https://docs.asaas.com/reference/listar-cobrancas), [existing customer](https://docs.asaas.com/reference/recuperar-um-unico-cliente).
