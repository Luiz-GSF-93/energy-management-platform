# Client Portal commercial module

`client_portal` is an optional commercial module in the catalog and the effective organization license. Only the platform administrator can change the catalog or that parent license. Catalog edits do not retroactively update license snapshots. The additive migration defaults every existing plan and license to `false`; it creates no invitations or client grants.

An organization administrator or manager can configure customer Portal licenses using the existing user-invite and license-view permissions. Both backend and database verify the active organization, role, permissions, customer and parent license. Operators and client accounts cannot configure Portal customers. Managers cannot grant organization/platform administrator roles or change commercial licensing.

Backoffice and Portal use the existing shared active membership quota. Customer registration and allocating a customer's maximum do not consume a seat; an active membership does. Customer seat limits and the parent quota remain transactional database authorities. Deactivating a membership releases its shared seat. Reaching the quota requires the existing upgrade request flow.

The client environment remains `/portal`, separate from `/backoffice`. Access requires an external read-only account with an exclusive customer binding, a current child license and the contracted parent module. Module-specific requests fail closed when entitlement is absent. Existing report and forecast readers preserve their published-only filters; Bot-Energy keeps the authorized customer context. This stage does not activate extra data readers for agenda, map or trading, or publish draft knowledge or financial records.

Invite provisioning continues through the existing invitation flow and approved EnergyOS email templates. No invitation, email or password is created by applying this migration. Actual pilot access must be reviewed separately against the named user/customer and license conditions.

Validation: backend Jest authorization/invitation tests, frontend DOM contract checks, TypeScript, Nest build and `backend/test/portal-commercial-sql.cjs` (isolated PostgreSQL via the existing PGlite dev dependency). A production schema dry-run must include an unconditional rollback and verify preserved RLS/RPC grants, parent quotas and the absence of existing exclusive Portal memberships before activation.
