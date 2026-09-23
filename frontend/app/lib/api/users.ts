import { apiRequest } from './client';

export type UserAffiliationType =
  | 'internal'
  | 'external';

export interface OrganizationUserRole {
  id: string;
  name: string;
}

export interface OrganizationUser {
  userId: string;
  email: string;
  name: string | null;
  affiliationType: UserAffiliationType;
  membershipStatus: string;
  role: OrganizationUserRole;
  invitedAt: string | null;
  acceptedAt: string | null;
}

export function getUsers():
  Promise<OrganizationUser[]> {
  return apiRequest<OrganizationUser[]>(
    '/api/v1/admin/users',
  );
}

export function getUser(
  userId: string,
): Promise<OrganizationUser> {
  return apiRequest<OrganizationUser>(
    `/api/v1/admin/users/${encodeURIComponent(userId)}`,
  );
}
