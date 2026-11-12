# Durable manual preparation

The API records an authorized preparation intent and returns HTTP 202. The private EVA worker reserves a durable execution slot before invoking the existing calculation service. The browser only polls status; closing the page does not cancel the intent. A persisted request alias prevents an unconfirmed acknowledgement from creating a second job, including after a coalesced job completes.

The queue checks current organization membership, effective permissions, module license and unit/customer scope at submission and execution. Tokens are never persisted. Operator preparation does not authorize financial approval or publication. Financial source gaps remain explicit; missing values are not replaced with zero.

Manual preparation, automatic intake and operational CCEE closing share a short database reservation lock per organization/customer/month. Calculations run outside the transaction. The existing worker capacity limit applies. A maximum of 20 queued/running manual requests per organization bounds intake. Expired pre-write leases can be recovered; an uncertain write becomes UNKNOWN and requires audited administrator reconciliation after the calculation ledger is safe. It is never retried automatically.

## Deployment

1. Apply additive migration `20261315_eva_manual_preparation_queue.sql` while the feature is disabled.
2. Deploy API, frontend and private EVA worker. Validate builds, worker bootstrap, readiness and existing flows.
3. Enable `EVA_MANUAL_PREPARATION_ASYNC_ENABLED=true` on the private worker first. `CALCULATION_AUTOFILL_ENABLED=true` is required.
4. Enable the API with `EVA_MANUAL_PREPARATION_ACCEPTING=false`. Wait for the old API instance to stop before accepting new requests.
5. Set API `EVA_MANUAL_PREPARATION_ACCEPTING=true`. Verify a real scoped request through QUEUED/RUNNING to its receipt and existing closing history, without financial approval.

## Rollback

First set API `EVA_MANUAL_PREPARATION_ACCEPTING=false`. Keep asynchronous status and the worker enabled to drain QUEUED/RUNNING work. Reconcile UNKNOWN with evidence. Only after no active or uncertain jobs remain may asynchronous coordination be disabled or old code restored. Do not drop queue tables or audit history. Existing frontend clients using the old synchronous endpoint receive a refresh instruction once asynchronous mode is enabled.

## Validation and remaining limits

Disposable SQL checks cover authorization, persisted request aliases, shared reservations, lease recovery, revocation, immutable audit, queue limits and privileges. Backend tests cover the API/worker boundary and ambiguous acknowledgements. UI tests cover reopen, read-only polling, lost response, denied access, paused intake and explicit reconciliation. These are correctness checks, not production load measurements. Representative load and a 24–72 hour observation period remain necessary. External OpenTelemetry/Prometheus/Grafana rollout is a separate stage; this phase reuses the existing bounded runtime/stage telemetry.
