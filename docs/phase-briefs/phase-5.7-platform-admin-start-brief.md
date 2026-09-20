# Phase 5.7 — Platform Admin — Start Brief

**Status:** Architecture Approved / Implementation Pending
**Phase:** 5.7 — Platform Admin
**Previous phase:** 5.6 — Consultant / External
**Architecture authority:** ADR 009

## 1. Objective

Implement the approved Platform Admin global access model without weakening
organization isolation or reintroducing legacy organization-role authority.

Platform Admin is a platform-scoped identity authorization path.

It is not an organization membership and it must not be implemented as an
organization authorization bypass.

## 2. Existing authoritative model

### Organization scope

Organization-scoped authorization remains:

JWT identity
→ user profile
→ active organization
→ active organization_members membership
→ organization role
→ permissions
→ organization context.

`organization_members` remains the sole authority for organization-scoped
roles introduced by Phase 5.5.

`user_roles` MUST NOT be used as an organization-role fallback.

### Platform scope

The live database already contains the required platform-role primitives:

- `roles.scope`
- exactly one current `scope = 'global'` role
- role name `admin_platform`
- 48 permissions on the current global role
- an explicit `user_roles` assignment to that role
- the assignment user identifier matches an existing authenticated profile.

Platform authorization is therefore:

JWT identity
→ explicit user_roles assignment
→ role
→ role.scope = global
→ role permissions
→ platform context.

The role name alone is not an authorization authority.

Possession of a `PLATFORM_*` permission alone is not sufficient to establish
platform scope.

## 3. Scope separation

Two authorization domains must remain distinct.

### OrganizationContext

Required properties:

- scope = `organization`
- userId
- email
- organizationId
- role
- roleId
- permissions
- optional JWT timing metadata.

Organization context requires an active membership.

### PlatformContext

Required properties:

- scope = `global`
- userId
- email
- role
- roleId
- permissions
- optional JWT timing metadata.

PlatformContext has no authoritative organizationId.

`user_profiles.organization_id` may continue to exist for compatibility, but
it MUST NOT be interpreted as the source of Platform Admin global authority.

`org_default` MUST NOT be used as a synthetic global organization.

## 4. Explicit platform endpoints

Platform context MUST only be resolved for endpoints explicitly marked as
platform-scoped.

Introduce explicit route metadata/decorator such as:

`@PlatformScope()`

Platform scope MUST NOT be inferred from:

- `/admin` path;
- role name;
- permission prefix;
- profile organization;
- absence of membership.

Existing organization administration endpoints using
`PLATFORM_ORGANIZATIONS_*` are candidates for explicit platform scope.

Organization user affiliation management remains organization-scoped unless
separately redesigned and approved.

## 5. TenantGuard contract

The guard must preserve existing flows.

### Public endpoints

No behavior change.

### Recovery endpoints

No behavior change.

JWT and profile validation remain required.

### Platform-scoped endpoints

After authoritative authentication:

1. load explicit `user_roles` assignments for the authenticated user;
2. resolve associated roles;
3. consider only roles whose `scope` is exactly `global`;
4. require exactly one valid global assignment;
5. obtain role ID, role name and permissions from that role;
6. construct PlatformContext;
7. do not require organization_members;
8. do not derive authority from `user_profiles.organization_id`.

Ambiguous or inconsistent global authority MUST fail closed.

Examples:

- multiple global assignments;
- missing referenced role;
- invalid role payload;
- unexpected query failure.

### Organization-scoped endpoints

Preserve the Phase 5.5 membership path.

Additionally, the resolved organization role must have organization scope.

Platform assignment MUST NOT automatically authorize an organization-scoped
endpoint.

## 6. RoleGuard contract

RoleGuard remains permission-based.

It consumes permissions from the context produced by the authoritative scope
resolver.

No authorization decision may depend solely on role name.

No global unconditional bypass is allowed.

## 7. TenantInterceptor contract

For organization scope, preserve current behavior.

For global scope:

- do not inject `organization_id`;
- do not validate body `organization_id` against a synthetic tenant;
- do not derive organization from `org_default`;
- allow explicitly platform-scoped handlers to operate without an active
  organization context.

## 8. OrganizationId decorator

Existing organization-scoped modules continue using `@OrganizationId()`.

Platform-scoped routes MUST NOT depend on this decorator.

The existing fallback to `org_default` is a security-hardening debt and is
not authority for Platform Admin.

It may be addressed separately if required by implementation safety.

## 9. Platform organization administration

The following permission family is platform-scoped:

- PLATFORM_ORGANIZATIONS_VIEW
- PLATFORM_ORGANIZATIONS_CREATE
- PLATFORM_ORGANIZATIONS_UPDATE
- PLATFORM_ORGANIZATIONS_DELETE

Organization administration routes must explicitly declare platform scope.

Platform Admin does not need organization membership to perform those
platform operations.

## 10. Audit contract

The current `audit_logs.organization_id` is NOT NULL and references
`organizations.id`.

No audit schema migration is introduced in this phase solely to represent
global scope.

When a global action has a target organization, audit using the target
organization as `audit_logs.organization_id`.

For organization deletion:

- actor = PlatformContext.userId
- target organization = route organization ID
- audit_logs.organization_id = target organization ID
- resource_type = organization
- resource_id = target organization ID.

`org_default` MUST NOT be recorded merely as a synthetic actor organization.

Future global actions with no organization target require a separate audit
schema decision.

## 11. RLS and backend authority

No RLS policy changes are planned for Phase 5.7.

The backend currently uses its privileged Supabase service client.

Therefore authorization MUST be explicitly enforced in backend code and must
fail closed.

Service-client privilege is not itself authorization.

## 12. Compatibility

Phase 5.7 must not:

- break organization membership authorization;
- change JWT claims;
- change organization switching semantics;
- make `organizationId` globally optional in existing organization services;
- restore `user_roles` as organization-role authority;
- create synthetic memberships for Platform Admin;
- rewrite RLS;
- change Client/Manager/Operator behavior;
- weaken tenant isolation.

## 13. Non-goals

Out of scope:

- global access to tenant data endpoints;
- automatic access to every document/customer/contract/consumer unit;
- platform impersonation;
- support-user impersonation;
- platform-wide user administration redesign;
- removal of legacy user_roles;
- global audit events without an organization target;
- broad RLS redesign;
- general authentication hardening.

## 14. Testing requirements

Implementation must include isolated tests covering at least:

A. organization-scoped flow remains membership-authoritative;

B. platform endpoint resolves a valid explicit global assignment;

C. platform endpoint does not require organization membership;

D. missing global assignment fails closed;

E. organization role cannot satisfy platform scope;

F. multiple global assignments fail closed;

G. malformed/missing global role fails closed;

H. global role query error fails closed;

I. PlatformContext permissions are sourced from the global role;

J. Platform Admin cannot obtain platform context on a normal organization
endpoint;

K. RoleGuard grants required platform permission from PlatformContext;

L. RoleGuard denies missing platform permission;

M. TenantInterceptor does not inject organization_id in global scope;

N. TenantInterceptor preserves existing organization behavior;

O. platform organization DELETE audits against the target organization, not
`org_default`.

Existing Phase 5.5 and Phase 5.6 tests must continue passing.

Production build must continue excluding spec files.

## 15. Implementation order

1. add explicit platform-scope metadata/decorator;
2. introduce discriminated access-context types with compatibility preserved;
3. extend TenantGuard only for explicitly platform-scoped handlers;
4. validate organization-role scope in normal tenant flow;
5. adapt RoleGuard typing without weakening permission enforcement;
6. adapt TenantInterceptor for explicit global context;
7. mark platform organization administration endpoints;
8. adapt organization-delete audit actor/target semantics;
9. add isolated tests;
10. run regression suite;
11. build production;
12. manual review;
13. checkpoint and publish.

No database migration is currently required.

## 16. Security invariant

Platform Admin global access means explicit platform authorization.

It does not mean bypassing authorization.

The invariant is:

authenticated identity
+ explicit global role assignment
+ role.scope = global
+ required permission
+ explicitly platform-scoped endpoint

All conditions are required.
