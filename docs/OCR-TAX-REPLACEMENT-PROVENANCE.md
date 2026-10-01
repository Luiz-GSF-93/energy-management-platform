# OCR tax replacement provenance

CDE expansion accepts the historical OCR CPFL label and the generic OCR fatura label only when invoice UUID, SHA-256 and predecessor lineage match. The basis composition determines CDE versus demand expansion. Existing scope, revision, approval, embedded-tax, atomic retirement and audit guards remain in force.

Validation: isolated PGlite regression covers both CPFL labels, Elektro demand, idempotency, tenant/source mismatch, stale and retired bases, invalid exclusions, predecessor preservation on failure, and denied browser execution. Other production triggers are not simulated by this isolated fixture.
