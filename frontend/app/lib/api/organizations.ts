import { apiRequest } from './client';

export interface Organization {
  id: string;
  name: string;
  description?: string | null;
  created_at?: string;
  updated_at?: string;
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
