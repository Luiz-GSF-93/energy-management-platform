export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  refresh_token?: string;
  user?: {
    id?: string;
    email?: string;
  };
}

export interface OrganizationContextSummary {
  name?: string;
  id: string;
  role: string;
  role_id: string;
}

export interface CurrentOrganizationContext {
  subscription?:{managed:boolean;organizationId?:string;state?:string;blocked?:boolean;notice?:string|null;overdueDays?:number;paidThrough?:string|null;oldestUnpaidDueOn?:string|null};
  name?: string;
  id: string;
  role: string;
  permissions: string[];
}

export interface SwitchOrganizationResponse {
  organizationId: string;
  organizationName: string;
  role: string;
  roleId: string;
}

export interface OrganizationAuthContext {
  accessMode?: 'platform_operation';
  scope?: 'organization';
  user: {
    id: string;
    email: string;
  };
  organizations: OrganizationContextSummary[];
  currentOrganization: CurrentOrganizationContext;
}

export interface PlatformAuthContext {
  scope: 'global';
  user: {
    id: string;
    email: string;
  };
  role: string;
  roleId: string;
  permissions: string[];
}

export type AuthContext =
  | OrganizationAuthContext
  | PlatformAuthContext;
