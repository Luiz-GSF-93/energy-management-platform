# Phase 5.6 – Consultant / External User – Start Brief

**Status:** Architecture Approved / Database Implementation Pending Schema Confirmation
**Phase:** 5.6
**Depends on:** ADR 009, Phase 5.5b.1, Phase 5.5b.2, Phase 5.5c
**Next phase:** 5.7 Platform Admin

---

## 1. Objective

Introduce the professional identity classification required to distinguish
internal employees from external consultants without creating a second
authorization model.

Phase 5.6 must preserve the approved multi-organization architecture.

An external consultant may have access to one or more organizations through
explicit organization memberships.

Being classified as external must not grant access by itself.

---

## 2. Approved Authorization Model

Authorization remains based on:

1. authenticated identity;
2. active organization context;
3. active organization membership;
4. organization-scoped role;
5. permissions attached to that role.

Conceptually:

identity
→ organization membership
→ organization role
→ permissions
→ active organization context

Professional classification such as internal/external is identity metadata,
not an authorization role.

---

## 3. External Consultant Semantics

An External Consultant:

- is an authenticated user;
- may have memberships in multiple organizations;
- receives access only through explicit active memberships;
- receives a role independently for each organization;
- receives permissions from that organization-scoped role;
- may switch only to organizations where a valid active membership exists;
- receives no platform-global access merely because the user is external.

An External Consultant may operationally have Manager-like access in an
organization when the assigned organization role and permissions provide it.

"External Consultant" itself is not a Manager role and does not imply Manager
permissions.

---

## 4. Internal User Semantics

An internal employee follows the same authorization pipeline:

identity
→ membership
→ organization role
→ permissions
→ active organization

Internal classification must not create an authorization bypass.

Internal status alone must not grant access to organizations.

---

## 5. Separation of Responsibilities

### Identity classification

Represents the professional relationship of the person with the platform or
operating company.

Examples:

- internal / employee;
- external / consultant.

### Organization membership

Represents which organizations the user may access.

Current authoritative runtime relation:

`organization_members`

### Organization role

Represents what the user may do inside a specific organization.

Current role authority is resolved through the active
`organization_members` membership and its organization-scoped role.

### Active organization

`user_profiles.organization_id` currently acts as the temporary active
organization pointer used by the runtime/RLS architecture established in
Phase 5.5.

It must not become the authority for professional classification.

---

## 6. Explicit Non-Goals

Phase 5.6 must NOT:

- create a second tenancy mechanism;
- create a second membership table;
- restore `user_roles` as an authorization authority;
- create `consultant` or `external` merely as authorization roles;
- grant permissions based only on internal/external classification;
- introduce Platform Admin global bypass;
- implement Phase 5.7 behavior;
- redesign JWT authentication;
- rewrite TenantGuard;
- rewrite RoleGuard;
- change RLS merely to support professional classification;
- delete the legacy `user_roles` table;
- modify organization switching semantics established in Phase 5.5b.2;
- weaken tenant isolation.

---

## 7. Current Runtime Facts

Discovery confirmed that the live Supabase/PostgREST schema exposes:

- `user_profiles`;
- `organization_members`;
- `roles`;
- legacy `user_roles`.

Phase 5.5c established `organization_members` as the authoritative membership
source for the new authentication context.

The continued physical existence of `user_roles` does not make it an
authorization authority for new Phase 5.6 functionality.

---

## 8. Database Schema Status

The repository does not currently contain a versioned migration describing
the live `organization_members` or `user_profiles` schema.

`backend/src/database/migrations` exists but was found empty during Phase 5.6
discovery.

`docs/supabase-schema.sql` does not contain the current authoritative
membership schema and therefore must not be treated as the source of truth
for Phase 5.6 database design.

Direct PostgreSQL catalog introspection was attempted using `DATABASE_URL`,
but the Codespace could not reach the PostgreSQL endpoint (`ENETUNREACH`).

Supabase/PostgREST HTTPS access succeeded and confirmed table existence, but
did not provide sufficient column/constraint metadata.

Therefore the exact database change for professional classification remains
pending schema confirmation.

---

## 9. Candidate Persistence Direction

Architecturally, professional classification belongs to identity-level
metadata rather than organization membership.

`user_profiles` is therefore the current candidate persistence location.

However, Phase 5.6 does NOT yet approve:

- the final column name;
- the SQL type;
- enum versus constrained text;
- nullability;
- default value;
- backfill behavior;
- database constraint;
- index requirements.

Those decisions require confirmation of the live `user_profiles` schema
before a production migration is written.

---

## 10. Guard / Tenant Context Impact

No authorization change is currently required in:

- TenantGuard;
- RoleGuard;
- TenantInterceptor;
- TenantContext;
- JWT claims.

Professional classification must not participate in tenant authorization
unless a later explicitly approved requirement demonstrates that it must.

Existing tenant isolation remains authoritative.

---

## 11. API Impact

Phase 5.6 implementation may later expose professional classification through
administrative user-management APIs.

Any such API must validate:

- authentication;
- authorization;
- tenant/platform scope;
- role;
- input;
- target user;
- allowed classification transition.

No client-controlled request may use professional classification to obtain
organization access.

Organization access continues to require an explicit membership.

---

## 12. Audit Requirements

Creation or modification of professional classification must be auditable.

Audit should capture, where applicable:

- acting user;
- target user;
- organization/context of the actor;
- action;
- previous classification;
- new classification;
- timestamp;
- origin;
- relevant record identifier.

Classification changes must not silently modify memberships, roles or
permissions.

---

## 13. Compatibility Requirements

Existing users must continue to authenticate and access organizations through
the Phase 5.5 membership model.

The Phase 5.6 migration must be backward compatible.

Before choosing a default/backfill strategy, the live schema and existing
identity semantics must be confirmed.

No existing user may lose organization access merely because the new
classification metadata is introduced.

---

## 14. Required Tests Before Completion

Phase 5.6 implementation must eventually validate at minimum:

1. internal user with valid membership;
2. external user with valid membership;
3. external user with memberships in multiple organizations;
4. external user cannot access an organization without membership;
5. internal user cannot access an organization without membership;
6. role remains organization-scoped;
7. cross-organization role mismatch fails closed;
8. inactive membership fails closed;
9. deleted organization fails closed;
10. organization switching remains membership-controlled;
11. professional classification alone grants no permissions;
12. professional classification change is audited;
13. existing Phase 5.5 auth-context tests remain green;
14. production backend build remains green.

---

## 15. Security Invariants

Phase 5.6 must preserve:

- backend-enforced tenant isolation;
- membership-based organization access;
- organization-scoped roles;
- permission validation;
- fail-closed behavior;
- auditability;
- no frontend-only authorization;
- no cross-tenant access;
- no implicit access from professional classification.

---

## 16. Implementation Gate

Implementation is NOT approved until the live schema needed for the chosen
persistence location is confirmed.

Required confirmation includes at least:

- relevant `user_profiles` columns;
- primary key;
- nullability/default conventions;
- applicable constraints;
- relevant RLS/policies;
- compatibility with existing profile creation/provisioning.

After schema confirmation, Phase 5.6 must define and review the exact migration
before applying it.

---

## 17. Phase Boundary

Phase 5.6 covers Consultant / External identity classification and its safe
integration with the already-approved membership architecture.

Platform-wide administrator access belongs to Phase 5.7 and must not be
implemented as part of Phase 5.6.

---

## 18. Current Decision

**Approved:**

- External Consultant is an identity/professional classification.
- It is not a tenancy mechanism.
- It is not an authorization role by itself.
- Organization access remains controlled by `organization_members`.
- Role and permissions remain organization-scoped.
- Active organization switching remains membership-controlled.
- No new authorization bypass is introduced.
- Phase 5.7 Platform Admin remains separate.

**Pending before implementation:**

- confirmation of the live persistence schema;
- final field/table design;
- migration;
- backfill/default strategy;
- administrative API contract;
- audit implementation details;
- implementation tests.
