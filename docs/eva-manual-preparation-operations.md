# Manual preparation monitoring

The EVA operational dashboard now has two independent read models: document intake and manual preparation. A failed query in one section does not cancel or repeat work in either queue. Polling reuses the bounded single-flight scheduler, pauses when hidden/offline, backs off after errors and clears cached rows on access denial. A tenant switch remounts both panels. Returned manual data must match the selected organization.

The new RPC `eva_manual_preparation_operations` is read-only and available only to the service role. It reuses the established document/license gate, rejects external or customer-bound users, and checks effective view/upload permissions for current internal administrator, manager or operator membership. Temporary platform support still uses its existing validated server context; it cannot be requested through query fields. The projection omits delegation, execution/lease tokens, operator identities and justification contents.

Counts represent canonical preparation protocols, not documents or coalesced request aliases. The window includes 30 days of history and all older queued/running/uncertain jobs. Pages are bounded at 25 with deterministic ordering. UNKNOWN, FAILED, expired leases and requests queued over five minutes appear in the attention filter. Five minutes is an operational alert threshold, not an SLA or an execution timeout. Lease expiry is projected without changing any record. Only the existing worker and audited reconciliation may recover work.

SUCCEEDED means the preparation result was acknowledged. It does not imply that financial sources are complete or that values were approved or published. The panel links to the established contract review and has no retry, approval, upload or reconciliation mutation buttons. Server command codes remain under support details.

## Deployment and recovery

Apply additive migration `20261316_eva_manual_preparation_operations.sql` before deploying the API/UI. It adds a scoped history index and a private SELECT-only function, without changing queue records or existing grants. Validate the migration and projection while dependencies are healthy, then deploy. The feature follows the existing asynchronous preparation flag. No new worker, external service or subscription is required.

Rollback can restore the previous monitoring code while preserving the added read-only function/index. Do not disable the asynchronous processing flag merely to hide this panel: the existing queue must be drained according to its own runbook. This monitoring change does not authorize increasing worker concurrency or replaying uncertain financial writes.

External metrics/alerts, remaining synchronous preparation paths, representative concurrent load tests and extended observation remain subsequent stages. This page supplies in-product operational alerts; it does not claim that external alert delivery has been configured.
