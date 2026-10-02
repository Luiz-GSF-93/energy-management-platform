# Financial settlement approval and publication

The preparation screen now links to a financial closing section. Preparing a settlement captures the customer and all active units for the selected month, runs the existing backend calculation engine over one database-statement snapshot, and stores a new DRAFT version. Existing review snapshots remain DRAFT review evidence; they are not settlement approval.

Approval and publication are separate manager actions. Each requires a reason and explicit acknowledgment of reservations. Tenant, permission, and free-market licence checks apply to every endpoint. The database checks the captured sources again before preparation, approval, and publication. A changed source or newer financial version requires a new preparation. Published amounts, evidence, authors, reasons, and reservations are immutable; later CCEE evidence must create another version.

The UI displays reservations, financial totals, per-unit allocation, source references, and approval/publication history. It does not clear diagnostic reviews or generate invoices, collection, or payments. Missing evidence remains missing and a qualified publication does not claim definitive tax or CCEE confirmation.

## Migration and validation

Migration 20261002_f1_84_financial_publication.sql extends the existing monthly_energy_settlements table. It preserves legacy rows, replaces the contract/month uniqueness constraint with contract/month/version uniqueness, and adds scoped preparation and transition functions. Direct service-role writes are replaced with scoped RPC writes; anonymous/authenticated access stays denied. No management_billings writes or RLS access expansion are introduced.

Before deployment, inspect the production catalog and verify relevant migration effects; file counts do not establish production schema completeness. The checked production catalog had the legacy settlement columns, no conflicting new functions, and existing SELECT access to the 19 source tables. The migration was tested in isolated PostgreSQL-compatible PGlite, including cross-tenant isolation, idempotency, changed-source rejection, legacy preservation, and published-row immutability.

Validation: backend/frontend type checks and builds; strict lint for modified frontend files and the new interface test; financial backend tests; interface and preparation regressions. Full frontend lint still has pre-existing failures and must be reported separately.
