# ADR 009 – Identity and Organization Membership Model

**Date:** 2026-09-17  
**Status:** Approved  
**Phase:** 5.3 – Identity Foundation (Architecture Decision)

## Context

Finding 008 documented: single-org-per-user de facto.

Decision Brief 009 specified business requirements: multi-tenant SaaS with hybrid identity supporting Clients, Managers, Consultants, Operators, Platform Admins.

This ADR formalizes the identity and membership architecture.

## Problem

Current schema assumes 1:1 user↔organization. Cannot support managers accessing multiple orgs, consultants with different scopes, or platform admins with global context.

## Decision

### 1. Identity Model: Hybrid Scope-Based Access

Each user has:
- Identity (auth.users)
- Role (Manager, Client, Operator, Admin Platform)
- Permissions (JSONB array)
- Organization Memberships (N:N)
- Scope (org-scoped or platform-scoped)

### 2. Organization Membership (Conceptual)



Rules:
- User can have N memberships (N >= 1)
- Membership links user to organization
- Platform Admin has implicit access to all orgs

### 3. Authorization Flow


### 4. User Personas

**Organization Client:**
- Single membership
- Can only access assigned org

**Internal Manager:**
- Multiple memberships
- Can switch org context
- Permissions validated per org

**External Consultant:**
- Multiple memberships (subset of orgs)
- Same as Manager

**Platform Admin:**
- Global scope
- No membership table needed
- Implicit access to all orgs

## Consequences

### Must Do (Before Phase 5.4)

1. Update TenantGuard:
   - Extract organization context from request
   - Validate user has membership
   - Set tenantContext.organizationId to requested org

2. Update RLS policies:
   - Use organization_id from request context
   - Validate membership before row checks

### Nice to Have (Post MVP)

- Contextual roles per organization
- Organization switching UI/API
- Platform admin audit log

### Deferred (Not in Scope)

- user_organization_memberships schema (Phase 5.5)
- Provisioning automation
- Advanced RLS scenarios

## Implementation Path

**Phase 5.3 (Current – Freeze):**
- ✅ Finding 008: State frozen
- ✅ Decision Brief 009: Business decision approved
- ✅ ADR 009: Technical architecture approved
- ⏸️ No schema changes yet

**Phase 5.4 (UPDATE/DELETE Organizations):**
- Update TenantGuard for org context validation
- Update RLS policies
- Test with context validation
- Still single-org de facto, but architecture supports multi-org

**Phase 5.5 (Multi-Org Implementation):**
- Create user_organization_memberships table
- Update provisioning
- Implement org switching

## Non-Goals (Out of Scope)

- JWT custom claims with org context
- Contextual roles per org
- Multi-org provisioning automation
- External user management UI

## Next Step

Phase 5.4 can proceed with multi-org-aware authorization without breaking schema changes.
