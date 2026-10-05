# Energy map - stage one

Tenant-scoped operational map with Mapbox GL JS 3.32.0. Existing CU/customer read permissions and CU update permission are reused. No new user grants.

Enable per organization with ENERGY_MAP_ORGANIZATIONS on the API. Frontend needs NEXT_PUBLIC_MAPBOX_TOKEN (public pk token restricted to the production origin). Default API rollout is off.

Apply backend/src/database/migrations/20261005_f9_energy_map.sql before enabling. This additive migration does not backfill coordinates or change registrations. RLS blocks browser access; RPCs verify live actor, license and tenant.

Manual coordinates require address confirmation, precision and reason. Updates use revision checking, address fingerprints and immutable audit with request idempotence. Address changes hide stale coordinates.

Bounded map pages, clustering, search and filters; counts describe the full filtered portfolio. No financial projections or invented location points. Automatic geocoding, OCR extraction, PostGIS queries and cross-tenant aggregates are later stages.

Rollback: remove organization IDs from ENERGY_MAP_ORGANIZATIONS; retain audited tables and history. Revert application release if required.

Validation: backend build; 35 database boundary checks; 8 map service tests; 13 frontend UI/data checks; frontend TypeScript and production build; tenant/role/license/CU regression tests.

Known baseline test failure: preparation-navigation.cjs fails at navigation never writes costs on unchanged main bcbb2db as well as this branch. Financial files are unchanged. Tenant/role/license/CU regression: 5 suites, 66 tests passed. Context recovery: 7 checks passed. Session renewal passed.
