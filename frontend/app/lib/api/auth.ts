import {
  apiRequest,
} from '@/app/lib/api/client';
import type {
  AuthContext,
  LoginRequest,
  LoginResponse,
  SwitchOrganizationResponse,
} from '@/app/lib/api/types';

export function login(
  input: LoginRequest,
): Promise<LoginResponse> {
  return apiRequest<LoginResponse>(
    '/api/v1/auth/login',
    {
      method: 'POST',
      authenticated: false,
      body: input,
    },
  );
}

export function getAuthContext(): Promise<AuthContext> {
  return apiRequest<AuthContext>(
    '/api/v1/auth/context',
  );
}

export function switchOrganization(
  organizationId: string,
): Promise<SwitchOrganizationResponse> {
  return apiRequest<SwitchOrganizationResponse>(
    `/api/v1/auth/switch-organization/${encodeURIComponent(
      organizationId,
    )}`,
    {
      method: 'POST',
    },
  );
}
