import { Request } from 'express';

export interface TenantContext {
  userId: string;
  organizationId: string;
  role: string;
  roleId: string;                    // ✓ NOVO: identificação única da role (auditoria)
  permissions: string[];
  email: string;
  iat?: number;                      // ✓ OPCIONAL: Unix timestamp do JWT (se decodificável)
  exp?: number;                      // ✓ OPCIONAL: Unix timestamp do JWT (if decodificável)
}

export interface RequestWithTenant extends Request {
  tenantContext?: TenantContext;
}
