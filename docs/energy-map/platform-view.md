Platform energy map — 2026-10-05

User explicitly requested a platform administrator view of every customer, including customers without consumer units.

GET /api/v1/admin/energy-map is a separate PlatformScope, private/no-store, read-only route. Both runtime and SECURITY DEFINER RPC require admin_platform plus the existing PLATFORM_ORGANIZATIONS_VIEW permission. The RPC rechecks the live global assignment and denies duplicate assignments. No tenant route, customer portal, role grants, licenses, or manual-location workflow is widened.

Includes non-deleted organizations/customers and units belonging to the same organization as their parent. Customers without units appear as NO_UNIT rows, without a manufactured point. Unconfirmed and stale coordinates never produce map markers. Counts are exact for the entire filtered inventory; a row represents a unit or a customer with no units. Pagination and current-page map coverage are explicit (UI 200, API maximum 500). Financial indicators and cross-organization edits remain outside this view.

Feature: ENERGY_MAP_PLATFORM_ENABLED=true in Railway. Default is disabled. Rollback: remove this flag, or revert this PR; preserve existing location/audit records. Additive migration 20261005_f10_energy_map_platform.sql creates only a service-only read RPC and changes no data.

Validation: backend build; 15 service boundary tests; 35 existing tenant SQL checks; 18 global SQL checks over 1,003 inventory rows; 18 frontend checks including multi-organization rendering, clients without units, XSS text handling, map coordinate scoping and return to tenant view. Frontend TypeScript/build and context regression are required before merge.

Global visibility does not geocode or publish positions automatically. Geocoding adapter draft is kept outside this PR pending separate provider/backend-credential/usage approval.
