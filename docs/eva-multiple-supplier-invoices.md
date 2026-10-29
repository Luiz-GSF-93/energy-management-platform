# Multiple supplier invoices

The existing verified supplier-document collector now builds a source-signed set for two to ten candidate files in the same organization, customer, unit and billing month. Each file still uses the established one-invoice extraction. No additional OCR call, table, permission or package-metering rule is introduced.

The compatible `supplier-invoice-proposal-1` and `supplier-invoice-evidence-1` payloads gain `setVersion: 1`. The source stores every document ID/hash and the set signature. Individual invoice quantities, prices, amounts and fiscal statements remain available. Totals use decimal arithmetic. The displayed weighted mean is nominal; mixed fiscal bases are disclosed.

Duplicates with the same verified file hash or a valid NF-e access key contribute once. Contradictory fiscal versions remain a review requirement. A missing fiscal key requires the operator to verify distinct notes during set confirmation. An unreadable candidate stays in the source set and its review requirements, while readable amounts remain proposed; it cannot silently disappear from a complete purchase.

`PER_INVOICE` tax treatment calculates additional destination ICMS inside separately on each net invoice, rounded per invoice. An invoice with ICMS already included retains its fiscal amount. Unknown treatment requires a source-backed per-invoice confirmation. A measured-volume difference never creates an extra purchase automatically.

Existing monthly supplier costs are consumed only when their source ID/hash and fiscal amount match one invoice, and only once. Additional documented purchases outside the invoice set retain the established current-cost-revision confirmation. Explicit prior manual allocations are preserved for review. CCEE cost requirements and estimates retain their existing behavior.

Coverage confirmation adds `invoiceSetHash` and optional `invoiceTaxes` to the existing audited allocation. A new source invalidates old group coverage without throwing away the proposed values. The closing capture verifies every source against organization/customer/unit/month/hash/type/verification, and the existing immutable source capture continues to guard financial approval. No existing publication is changed.

Documents displays all invoices and their individual values in one review table, followed by combined volume/value and the relevant remaining decisions. The existing source-change wakeup resumes unpublished distributor proposals when later NFs are archived. NF-before-distributor and distributor-before-NF remain supported; published closings retain their existing guard. Existing queue leasing, idempotency and quotas remain in force.

To test: upload each supplier NF separately through Documents → Send to EVA; upload the distributor bill through the client portal or Documents. Wait for the existing reading/recognition stages, then open the competence proposal. Confirm only the set coverage and any genuinely unknown fiscal treatment; financial approval remains separate. The implementation tests do not assert that any future customer file has already passed OCR.

Validation: multi-invoice financial/source tests, single-invoice and closing regressions, intake-worker late-source/replay tests, DOM tests for prefilled multi-note review, source changes, uncertain writes and the animated EVA validation indicator. CI includes the dedicated Multiple supplier invoices workflow.
