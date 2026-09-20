# Phase 5.7 — Platform Admin Closeout

Date: 2026-09-20
Status: CLOSED / VALIDATED
Architecture authority: ADR 009
Functional checkpoint: 48eea241ceb4ed7eda53e663eab7ee36f5c2b12b

## Objective

Implement Platform Admin as an explicit global authorization scope without
weakening organization-scoped multitenancy.

## Authorization model

Organization scope:

JWT
→ authenticated identity
→ active organization
→ active organization_members membership
→ organization-scoped role
→ permissions
→ OrganizationContext

Platform scope:

JWT
→ authenticated identity
→ explicit user_roles assignment
→ role.scope = global
→ permissions
→ PlatformContext

Role name alone is not authorization authority.

A global assignment does not automatically grant access to organization-scoped
resources.

## Implementation

Phase 5.7 commits:

- cfde7e4 — Document Phase 5.7 platform admin architecture
- 6f461f0 — Add Phase 5.7 platform scope foundation
- 6268dd8 — Resolve Phase 5.7 platform authorization context
- cb30854 — Support Phase 5.7 access context consumers
- 48eea24 — Activate Phase 5.7 platform organization administration

Implemented:

- explicit @PlatformScope() metadata;
- discriminated OrganizationContext / PlatformContext;
- explicit global assignment resolution in TenantGuard;
- exact role.scope validation;
- RoleGuard support for AccessContext;
- TenantInterceptor global-scope isolation;
- Platform Scope activation on /admin/organizations;
- target-organization audit semantics for organization deletion.

## Database

No Phase 5.7 database migration.

No RLS changes.

Existing user_roles is used only as the global assignment authority.

Existing organization_members remains the organization assignment authority.

No fake membership was introduced.

No synthetic org_default global context was introduced.

## Permissions

Platform organization administration remains permission-based:

- PLATFORM_ORGANIZATIONS_VIEW
- PLATFORM_ORGANIZATIONS_CREATE
- PLATFORM_ORGANIZATIONS_UPDATE
- PLATFORM_ORGANIZATIONS_DELETE

No role-name authorization bypass was introduced.

## Automated validation

Phase 5.7 test coverage includes:

- platform scope metadata;
- TenantGuard global authorization;
- organization scope preservation;
- RoleGuard AccessContext authorization;
- TenantInterceptor scope isolation;
- OrganizationsController platform activation;
- OrganizationsService target-organization audit behavior.

Production build:

- nest build: PASS
- compiled test specs in dist: 0

## Runtime validation

Deployment status: SUCCESS

Public health:

- GET /api/v1/health → 200

Platform endpoint negative authentication:

- no Bearer token → 401
- invalid Bearer token → 401

Platform Admin:

- authentication → 201
- GET /api/v1/admin/organizations → 200

Platform Admin isolation from organization endpoints:

- GET /api/v1/customers → 403
- GET /api/v1/consumer-units → 403
- GET /api/v1/contracts → 403
- GET /api/v1/documents → 403

This confirms that explicit global authorization does not automatically bypass
organization-scoped authorization.

Organization-only user → platform endpoint:

NOT_EXECUTED_CREDENTIAL_UNAVAILABLE

The existing organization-only identity could not be authenticated with the
available credential. No password reset, fixture mutation, membership mutation,
or production-data mutation was performed solely to satisfy this runtime test.

The negative path remains covered structurally by automated authorization tests.

## Audit

For Platform Admin actions targeting a specific organization, audit ownership is
the target organization and actor identity is the authenticated Platform Admin.

The current audit schema requires organization_id.

Truly global actions without an organization target remain outside Phase 5.7
and require a separate audit-schema decision.

## Compatibility

Preserved:

- existing JWT authentication contract;
- organization membership authorization;
- organization switching;
- manager/operator/client organization isolation;
- existing RLS configuration;
- existing organization-scoped APIs.

Platform Admin was not granted automatic tenant-domain access or impersonation.

## Known deferred items

- organization-only → platform real HTTP test was not executed because a usable
  credential was unavailable;
- Railway deployment provenance was operational/temporal; the inspected Railway
  metadata did not expose the deployed Git SHA;
- global actions without an organization target need a future audit design;
- existing @OrganizationId org_default fallback remains a hardening debt;
- previously identified credential/fallback security debt remains outside this
  phase and must be handled in a separate security checkpoint.

## Final validation

- branch: main
- functional checkpoint: 48eea241ceb4ed7eda53e663eab7ee36f5c2b12b
- production build: PASS
- runtime authorization: PASS
- global → organization isolation: PASS
- database mutation during runtime validation: NONE
- business-data mutation during runtime validation: NONE
- RLS mutation: NONE
- JWT contract mutation: NONE

## Result

Phase 5.7 Platform Admin is CLOSED / VALIDATED.

The implementation preserves the approved hybrid authorization model:

organization membership authority for organization scope, and explicit global
assignment authority for Platform scope.
