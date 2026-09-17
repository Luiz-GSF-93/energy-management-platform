# Phase 5.4 Start Brief – Organizations UPDATE/DELETE

**Date:** 2026-09-17  
**Phase:** 5.4 – Organizations UPDATE/DELETE Operations  
**Status:** Ready to Start (Prerequisites from ADR 009 met)  
**Duration:** TBD  
**Blocking Issues:** None

---

## Context

Phase 5.3 concluded with:
- Finding 008: State documented (single-org de facto)
- Decision Brief 009: Business decision approved (multi-tenant hybrid model)
- ADR 009: Architecture formalized (identity + membership model)

Phase 5.4 implements UPDATE/DELETE for organizations, preparing infrastructure for multi-org support WITHOUT prematurely implementing multi-org itself.

---

## Scope

### In Scope (5.4)
- PATCH /organizations/{org_id} – Update organization metadata
- DELETE /organizations/{org_id} – Soft delete organization
- Context validation (org_id from request + user authorization)
- Audit logging for all changes
- RLS policy verification for UPDATE/DELETE
- Regression tests for existing READ/CREATE

### NOT in Scope (Deferred to 5.5)
- User organization memberships table
- Multi-org user switching
- Consultant/external user provisioning
- Contextual roles per organization
- Platform admin organization access patterns

---

## Guardrails (Non-Negotiable)

### G1: Context is Request Data, Not Authorization



### G2: TenantGuard Enforces Authorization


### G3: RLS is Secondary Defense, Not Primary


### G4: No Provisioning Changes Yet


### G5: Audit Everything Critical


### G6: DELETE is Soft Delete + Cascade Logic


### G7: Tenant Bypass Protection


### G8: No Breaking Changes to Existing APIs


---

## Technical Requirements

### TR1: PATCH /organizations/{org_id}


### TR2: DELETE /organizations/{org_id}


### TR3: TenantGuard Enhancement (Minimal)


### TR4: RLS Policy Review (No Changes Yet)


---

## Testing Requirements (Mandatory)

### T1: Authorization Tests


### T2: Tenant Bypass Protection


### T3: DELETE Tests


### T4: Regression Tests


### T5: Audit Trail Tests


### T6: RLS Verification


---

## Implementation Steps

### Step 1: Code Review Existing Structure
- [ ] Review TenantGuard current behavior
- [ ] Review RoleGuard current behavior
- [ ] Review RLS policies on organizations/customers/documents

### Step 2: Implement PATCH /organizations/{org_id}
- [ ] Controller endpoint
- [ ] DTO validation
- [ ] TenantGuard check
- [ ] RoleGuard check (@RequirePermission)
- [ ] Service business logic
- [ ] Audit logging
- [ ] Error handling

### Step 3: Implement DELETE /organizations/{org_id}
- [ ] Controller endpoint
- [ ] Soft delete logic (set deleted_at)
- [ ] Dependency checking (customers/documents/contracts)
- [ ] Cascade strategy (block vs mark inactive)
- [ ] Audit logging
- [ ] Error handling

### Step 4: Write Tests
- [ ] Authorization tests (T1)
- [ ] Tenant bypass tests (T2)
- [ ] DELETE tests (T3)
- [ ] Regression tests (T4)
- [ ] Audit trail tests (T5)
- [ ] RLS verification (T6)

### Step 5: Manual Testing
- [ ] Test with Postman/Insomnia
- [ ] Verify JWT validation
- [ ] Verify permission checks
- [ ] Verify audit logs
- [ ] Verify RLS in action

### Step 6: Regression Testing
- [ ] Run Phase 5.2 tests (CREATE)
- [ ] Run Phase 5.0 tests (READ)
- [ ] Ensure no breakage

### Step 7: Documentation
- [ ] Update API docs (UPDATE/DELETE endpoints)
- [ ] Document audit fields
- [ ] Note Phase 5.5 preparedness

---

## Acceptance Criteria

- [ ] PATCH /organizations/{org_id} endpoint works
- [ ] DELETE /organizations/{org_id} endpoint works
- [ ] All authorization tests pass
- [ ] All tenant bypass tests pass
- [ ] All regression tests pass
- [ ] Audit logs capture all changes
- [ ] RLS policies verified (not changed, but verified)
- [ ] No breaking changes to existing APIs
- [ ] Code ready for Phase 5.5 multi-org membership addition

---

## Non-Acceptance Criteria

- ❌ Implementing multi-org membership in 5.4
- ❌ Changing user_profiles schema
- ❌ Hard delete without audit trail
- ❌ Trusting org_id from request without validation
- ❌ Skipping RLS verification tests
- ❌ Breaking existing READ/CREATE functionality
- ❌ Missing audit logs

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Tenant bypass | Three-layer validation: backend + RLS + audit |
| Data loss | Soft delete only, preserve history |
| Authorization gap | RoleGuard + TenantGuard + tests |
| Regression | Test all existing APIs before releasing |
| Incomplete audit | Mandatory logging on all changes |

---

## References

- ADR 009: Identity and Organization Membership Model
- Finding 008: Current state (single-org)
- Decision Brief 009: Multi-tenant business decision
- Phase 5.2: Organizations CREATE (reference implementation)
- Phase 5.0: Organizations READ-ONLY (reference implementation)

---

## Success Metrics

- ✅ UPDATE/DELETE implemented per spec
- ✅ 100% authorization tests pass
- ✅ 100% tenant bypass tests fail (as designed)
- ✅ All regression tests pass
- ✅ Audit trail complete
- ✅ Code review approved
- ✅ Ready for Phase 5.5

---

## Next Checkpoint

After Phase 5.4 completion:
- Review results against acceptance criteria
- Validate no regressions in Phase 5.0/5.2
- Plan Phase 5.5: Multi-Org Membership Implementation
- Document lessons learned
