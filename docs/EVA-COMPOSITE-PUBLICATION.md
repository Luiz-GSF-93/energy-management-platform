# Composite official corpus

This increment is delivered disabled. It does not approve the REN1000, execute provider calls, publish content, or change the existing pilot's flags.

## Access and data

`20261107_eva_composite_publication.sql` adds exactly three private tables and seven functions. It does not replace existing functions, grant roles to users, or modify the existing guard against publishing an isolated derived part. Forced RLS and revoked direct table grants apply to all three tables. Only the action and retrieval RPCs are executable by `service_role`; the HTTP actor is resolved from the authenticated session.

Owner manages composite releases. A different active Owner must review each release. Finance has aggregate metrics only; Support and organization users have no composite administration access. Retrieval delegates to the existing corpus authorization gate, including active membership, permissions, license, organization pilot and the explicit Owner operation session.

## Coverage and execution

A current independently reviewed document-part set is required. Every part must reference its current reviewed curation, with complete page coverage, no unresolved issues and matching applicability dates. Preparation validates and freezes the exact section text, offsets, hashes and references. Original page numbers survive subdivision. Limits: 101–500 original pages, 2–25 parts, 2,000 chunks in total and 100 chunks per batch. Oversized sections require curation; they are not silently truncated.

Each composite has one Search `releaseId`, so retrieval queries the whole document once, rather than once per part. The existing eight-source and six-final-evidence limits remain. The legacy 100-chunk source limit is unchanged.

Indexing and publication each claim one explicit batch with a durable lease and an immutable command event. Indexing requires a token ceiling at least as large as the UTF-8 byte reservation. Generated vectors are persisted before upload. Publication first verifies the private remote record, changes only its publication bit, then verifies the resulting record. Every chunk needs a matching receipt. No composite source becomes eligible until all batches are published and their source/review chain is still current.

Timeouts, partial work, incomplete receipts and divergent remote content remain `UNKNOWN`. Explicit recovery is GET-only: it never regenerates embeddings, uploads chunks or repeats publication. Missing persisted vectors cannot be recovered by replay. There is no automatic retry loop. Quarantine immediately prevents retrieval, even if remote records remain present.

## Gates and rollout

- `EVA_COMPOSITE_PUBLICATION_ENABLED=false`: private commands and metrics off.
- `EVA_COMPOSITE_CALLS_ENABLED=false`: composite provider execution off; existing index/embedding gates must also permit the particular operation.
- `EVA_COMPOSITE_RAG_ENABLED=false`: the chat uses the unchanged legacy RPC. When explicitly enabled later, the additive RPC supports legacy and composite proofs, preserving quota reservation and per-query revalidation.

Validate builds and disposable SQL tests before an audited migration dry-run and apply. Compare all pre-existing rows, ACLs, functions and triggers; the migration seeds no data. Keep all three new gates off for delivery. REN1000 extraction drafts are not eligible and must not receive simulated reviews to bypass this requirement.

## Monitoring

Owner and Finance see monthly composite preparation, embedding tokens, reserved provider requests, uncertain batches and retrieval aggregates in Costs and performance. Reservations do not prove provider execution. Monetary billing remains unconfirmed until evidence exists; query embeddings already belong to the AI usage ledger and must not be counted twice. Fixed Search/Blob charges and budgets remain in the existing service catalogue.

## Validation

`backend/test/eva-composite-publication.cjs` composes checked-in disposable fixtures and applies actual migrations. Default execution uses PGlite. `EVA_COMPOSITE_TEST_PG_PORT=55483` permits only an isolated PostgreSQL server on loopback at that port (trust authentication, no application credentials), using `pg` supplied by the test environment. That mode additionally races two independent claims and requires one reservation and one conflict. The SQL harness loads the actual legacy retrieval authorization RPC, without substituting a weaker stub.

Run the composite model/service and corpus Jest suites, the SQL harness, the existing corpus regression harness, the composite UI DOM test, and Nest/Next builds. Provider adapters are simulated in these tests; no paid calls are made.
