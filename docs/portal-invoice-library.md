# Portal invoice library

Scope authorized on 2026-10-22: dedicated invoice page, annual twelve-month navigation, unit/month/year filters, legacy backoffice invoices, inline private viewer and EVA assistance. Existing payment declarations remain customer statements, never bank reconciliation.

Architecture: reuse PortalWorkspace, entitlement checks and receipt/payment APIs. An additive private gateway makes verified current backoffice distributor invoices available to the bound customer, recording a no-consent library link and an explicit origin event. No document copies, OCR jobs, notifications, financial approvals or new tables. Ambiguous current invoice chains are not chosen automatically. Annual reads are bounded to active authorized units and the requested year; original intake APIs remain compatible.

Viewer: authenticated bytes, verified SHA-256 and private storage path; PDF.js renders one page at a time locally. No third-party document viewer, iframe or browser PDF extension. Abort and release buffers on close. Image invoices use the same private bytes. Existing HTML transcription remains separate.

Financial composition: period/month/unit display filters over published sources only. Consolidation requires every selected source to have reconciled components; sum exact cents and recompute percentages, never average percentages or invent missing values.

Migration preserves documents, original consent, payment audit and validated closings. Library links have consent=false and are excluded from automatic processing. Rollback can revert application routes while retaining additive audited links. Test tenant isolation, year filtering, idempotent linking, ambiguous sources, hash mismatch, PDF/image rendering, modal navigation, payment statement compatibility and exact composition aggregation.

Waste correction impact approved explicitly on 2026-10-22: one private append-only audit table; per-publication/unit/hash/charge identity, actor/time and revision. Server derives charge label/amount from published records. Idempotency and optimistic revision checks prevent double counting; undo appends a revision. Current-period potential is calculated in exact cents. EVA receives the declaration with an explicit non-realized-savings qualification. No financial approval, banking confirmation or paid provider calls.
