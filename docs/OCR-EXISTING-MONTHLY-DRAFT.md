# OCR integration into an existing draft

A manual monthly draft previously blocked consumption integration and subsequent billed demand integration. A reviewed invoice can now link compatible consumption to the latest draft, preserving measured demands, notes, origin and audit history. Existing unequal consumption, validated versions, different customers/documents and stale revisions remain blocked.

Apply 20261001_f1_174_existing_ocr_draft.sql before backend release. The RPC retains tenant guards, entitlement checks, actor identity, row/month locks and immutable evidence. It never accepts browser-supplied measurements. Repeated requests return the same link; final validation rechecks the reviewed source.

This fixes integration after confirmed reviews. It does not assert 100% unattended OCR, bypass confidence thresholds, approve financial data or invent missing ACR tariffs, supplier costs or fees.
