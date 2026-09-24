import { apiRequest } from './client';

export interface Organization {
  id: string;
  name: string;
  description?: string | null;
  registration?: Record<string, string>;
  created_at?: string;
  updated_at?: string;
}

export interface CreateOrganizationRequest {
  name: string;
  description?: string;
}

export interface UpdateOrganizationRequest {
  name?: string;
  description?: string;
}

export function getOrganizations():
  Promise<Organization[]> {
  return apiRequest<Organization[]>(
    '/api/v1/admin/organizations',
  );
}

export function getOrganization(
  id: string,
): Promise<Organization> {
  return apiRequest<Organization>(
    `/api/v1/admin/organizations/${encodeURIComponent(id)}`,
  );
}

export function createOrganization(
  input: CreateOrganizationRequest,
): Promise<Organization> {
  return apiRequest<Organization>(
    '/api/v1/admin/organizations',
    {
      method: 'POST',
      body: input,
    },
  );
}

export function updateOrganization(
  id: string,
  input: UpdateOrganizationRequest,
): Promise<Organization> {
  return apiRequest<Organization>(
    `/api/v1/admin/organizations/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: input,
    },
  );
}

export function deleteOrganization(
  id: string,
): Promise<void> {
  return apiRequest<void>(
    `/api/v1/admin/organizations/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
    },
  );
}
