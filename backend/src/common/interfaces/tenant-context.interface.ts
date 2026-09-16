import { Request } from 'express';

export interface TenantContext {
  userId: string;
  organizationId: string;
  role: string;
  permissions: string[];
  email: string;
  iat: number;
  exp: number;
}

export interface RequestWithTenant extends Request {
  tenantContext?: TenantContext;
}
