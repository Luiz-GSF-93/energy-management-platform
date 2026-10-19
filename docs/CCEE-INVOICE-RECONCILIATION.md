# CCEE: invoice reconciliation and measurement export

New gates default to disabled: `CCEE_RECONCILIATION_ENABLED` and
`CCEE_READING_DIAGNOSTICS_ENABLED`. Existing R1 flags and queues are preserved.
No provider reads, OCR runs, AI calls, financial approvals or publications are
performed by the new reconciliation endpoints.

The additive migration `20261115_ccee_invoice_reconciliation.sql` creates one
private immutable snapshot table and a backend-only RPC. It preserves the
source fingerprint, invoice OCR job/hash, CCEE execution/hash, unit, month,
formula, author, reason and idempotency key. It serializes versions, checks
current representation and license and rejects changes to the source between
read and save. Direct table access and RPC execution by browser roles are denied.
CCEE permissions plus document read permission are required; monthly writes
continue through the existing separately authorized draft adapter.

`GET jobs/:id/invoices`, `POST jobs/:id/reconciliations`,
`GET reconciliations?unitId=…&month=…&page=…`, and
`GET jobs/:id/measurements.csv` are under `/api/v1/ccee-data`.
CSV export contains hourly active values and separate reactive source values,
provenance and quality. Formula-like text is escaped. Failed or incomplete
executions cannot be exported as complete measurements.

The deterministic comparison uses decimal integers: CCEE minus invoice kWh;
percentage divides that difference by invoice kWh. Zero denominator produces
no percentage. Full FINAL coverage, exact matching interval, verified identity
and no-loss bases are required. Unknown losses, date-only invoice periods,
partial coverage and missing quantities remain explicit review issues.
No peak/off-peak partition, demand, loss factor or normative violation is inferred.
Invoice quantities reuse the preserved layout parser. A source check may be
recorded explicitly by the operator, with exact interval, loss basis and a
reference to the page/fields checked; this statement does not become an OCR
finding, change the document, change the CCEE binding or approve finances.

The CCEE workspace offers invoice selection, a visible saved status, source
review and export. Operational reports can consult these internal snapshots
separately from their published financial version. The improved EVA closing
context includes at most two matching snapshots when authorized, labels them
as non-normative evidence and rechecks them after answering. Official rules
continue through the existing published RAG and permission checks.

Diagnostics keep validation strict. With the diagnostic gate enabled, point,
time format, interval and duplicate timestamp errors are distinct; HTTP status,
source hash and opaque Transaction ID are captured before row validation.
No raw XML, credential, certificate material or provider free text is logged.
There is no automatic retry or correction of a provider response.

Remaining external validation:
- The real Del Rei H1 on 19 October stopped after one request with the legacy
  combined mismatch error. No measurement was imported and no second read was
  made during development. A future explicitly bounded diagnostic is necessary
  to identify which response field differs; no compatibility relaxation is claimed.
- Official calendar management is enabled, but no official version has been
  imported/reviewed. The public download returned HTTP 403 in this session;
  its real workbook layout and deadlines remain unverified. The UI now makes
  this empty state explicit. Collection still requires explicit timestamps;
  it never invents an hour from a date-only cell.
- The Del Rei binding has POINTS/MEASUREMENTS and UNKNOWN loss basis. It does
  not authorize AGENDA or prove a no-loss comparison. Any evidenced amendment
  must use the existing independent review flow.
- DRI accounting, settlement, contract transmission and other provider write
  operations remain separate phases. Keeping the queue worker enabled does
  not schedule all monthly provider services or close any CCEE obligation.

Rollback: leave the additive table/history intact and disable only the two new
gates. No rollback requires deleting data or modifying the existing corpus.
