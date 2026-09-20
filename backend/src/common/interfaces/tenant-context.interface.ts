import { Request } from 'express';

interface BaseAccessContext {
  userId: string;
  role: string;
  roleId: string;
  permissions: string[];
  email: string;
  iat?: number;
  exp?: number;
}

export interface OrganizationContext extends BaseAccessContext {
  scope: 'organization';
  organizationId: string;
}

export interface PlatformContext extends BaseAccessContext {
  scope: 'global';
}

/**
 * Authorization context for requests whose scope has been explicitly resolved.
 *
 * Phase 5.7 introduces this discriminated union incrementally.
 * Runtime authorization is not changed by this type alone.
 */
export type AccessContext = OrganizationContext | PlatformContext;

/**
 * Compatibility contract for the existing organization-scoped runtime.
 *
 * Existing TenantGuard consumers continue using TenantContext until the
 * Platform Admin runtime path is introduced in a later Phase 5.7 checkpoint.
 */
export interface TenantContext extends BaseAccessContext {
  organizationId: string;
  scope?: 'organization';
}

export interface RequestWithTenant extends Request {
  tenantContext?: TenantContext;
  accessContext?: AccessContext;
}
