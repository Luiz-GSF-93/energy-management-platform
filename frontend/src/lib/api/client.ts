'use client';

export interface ApiResponse<T> {
  statusCode: number;
  message?: string;
  data?: T;
  error?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
  };
}

interface FetchOptions extends RequestInit {
  skipAuth?: boolean;
}

export async function apiClient<T = any>(
  endpoint: string,
  options: FetchOptions = {},
): Promise<ApiResponse<T>> {
  const { skipAuth = false, ...fetchOptions } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string>),
  };

  if (!skipAuth) {
    const token = localStorage.getItem('auth_token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    } else {
      if (typeof window !== 'undefined') {
        window.location.href = '/auth/login';
      }
      throw new Error('Não autenticado');
    }
  }

  const url = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}${endpoint}`;

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      headers,
    });

    if (response.status === 401) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('tenant_id');
      localStorage.removeItem('user_role');
      if (typeof window !== 'undefined') {
        window.location.href = '/auth/login';
      }
      throw new Error('Sessão expirada');
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || `Erro ${response.status}`);
    }

    return data;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

export const api = {
  contracts: {
    create: (payload: any) =>
      apiClient('/api/v1/contracts', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    list: (params?: { status?: string; page?: number; limit?: number }) => {
      const query = new URLSearchParams();
      if (params?.status) query.append('status', params.status);
      if (params?.page) query.append('page', params.page.toString());
      if (params?.limit) query.append('limit', params.limit.toString());
      return apiClient(`/api/v1/contracts?${query.toString()}`);
    },
    get: (id: string) =>
      apiClient(`/api/v1/contracts/${id}`),
    update: (id: string, payload: any) =>
      apiClient(`/api/v1/contracts/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
    delete: (id: string) =>
      apiClient(`/api/v1/contracts/${id}`, {
        method: 'DELETE',
      }),
    analytics: () =>
      apiClient('/api/v1/contracts/analytics/overview'),
  },

  fees: {
    create: (payload: any) =>
      apiClient('/api/v1/fees', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    list: (params?: { status?: string; contractId?: string }) => {
      const query = new URLSearchParams();
      if (params?.status) query.append('status', params.status);
      if (params?.contractId) query.append('contractId', params.contractId);
      return apiClient(`/api/v1/fees?${query.toString()}`);
    },
    get: (id: string) =>
      apiClient(`/api/v1/fees/${id}`),
    update: (id: string, payload: any) =>
      apiClient(`/api/v1/fees/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
    updateStatus: (id: string, status: string) =>
      apiClient(`/api/v1/fees/${id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      }),
    delete: (id: string) =>
      apiClient(`/api/v1/fees/${id}`, {
        method: 'DELETE',
      }),
    analytics: () =>
      apiClient('/api/v1/fees/analytics/overview'),
  },

  approvals: {
    create: (payload: any) =>
      apiClient('/api/v1/approvals', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    list: (params?: { status?: string; feeId?: string }) => {
      const query = new URLSearchParams();
      if (params?.status) query.append('status', params.status);
      if (params?.feeId) query.append('feeId', params.feeId);
      return apiClient(`/api/v1/approvals?${query.toString()}`);
    },
    get: (id: string) =>
      apiClient(`/api/v1/approvals/${id}`),
    approve: (id: string) =>
      apiClient(`/api/v1/approvals/${id}/approve`, {
        method: 'PUT',
      }),
    reject: (id: string, reason: string) =>
      apiClient(`/api/v1/approvals/${id}/reject`, {
        method: 'PUT',
        body: JSON.stringify({ reason }),
      }),
    analytics: () =>
      apiClient('/api/v1/approvals/analytics/overview'),
  },

  auth: {
    login: (email: string, password: string) =>
      apiClient('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
        skipAuth: true,
      }),
    profile: () =>
      apiClient('/api/v1/auth/me'),
  },
};
