# EVA Search 2C1 — private preparation

Default off: `EVA_SEARCH_PREPARATION_ENABLED`, `EVA_SEARCH_INDEX_CALLS_ENABLED`,
`EVA_SEARCH_QUERY_CALLS_ENABLED`. This increment registers private preparation
and metrics endpoints. It does not connect a worker or replace the active RAG.

Five additive tables preserve the source review, chunks, initial private job,
events and future evaluations. One release references one exact reviewed PDF
version; a corpus containing two PDFs requires two explicit preparations.
Approval requires an active Owner different from the preparation's author.
`APPROVED_PRIVATE` is never `PUBLISHED`; no publication command is included.

Chunks retain article/exception context and whole bounded tables/flows with
their legends. Curated codepoint offsets are stored separately from original
PDF extraction offsets. Original sources and historical curation stay intact.

The transport uses HTTPS, stable REST 2024-07-01, fixed Search endpoints,
separate Entra query/index identities, one attempt, bounded response and
preFilter on every hybrid query. The transport is not publicly invokable.
Actual index creation, paid embeddings, durable external execution/recovery,
publication and chat integration require later approved increments. In
particular PREPARED_PRIVATE jobs do not have a processing lease yet and cannot
be executed in this phase. No promise of production throughput or latency.

Costs: query private metrics through the existing Owner/Finance permissions.
Azure AI Search/embeddings/OpenAI presets already exist in the service catalog;
no duplicate seed or invented currency amount is added. Preparation metrics
show unknown monetary cost as null/NOT_CONNECTED, not zero. A Blob budget does
not cover Search. Confirm regional capacity, tariff and budget before provision.

Tests: `node node_modules/jest/bin/jest.js src/modules/ocr/eva-search.spec.ts --runInBand`
and `node test/eva-search-preparation.cjs`. Database tests use disposable PGlite
with source/actor fixtures and actual platform_team_owner function; no credentials.
Run existing official source/extraction, guide, RAG/budget regression checks too.
Migration must be inventoried/dry-run before shared DB application; zero seeds.
Rollback is disabling flags, retaining audit records, not dropping tables.
