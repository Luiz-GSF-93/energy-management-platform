import { getSession } from '@/auth';

interface RequestOptions extends RequestInit {
  params?: Record<string, any>;
}

class ApiClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    // Garantir que não há /api/v1 duplicado
    this.baseUrl = this.baseUrl.replace(/\/api\/v1\/?$/, '');
  }

  private async request<T>(
    path: string,
    method: string = 'GET',
    options?: RequestOptions
  ): Promise<T> {
    // Garantir que o path começa com /
    let url = path.startsWith('/') ? path : `/${path}`;
    
    // Se o path já tem /api/v1, não duplicar
    if (!url.includes('/api/v1')) {
      url = `/api/v1${url}`;
    }

    const fullUrl = `${this.baseUrl}${url}`;
    console.log(`[API] ${method} ${fullUrl}`);

    const session = await getSession();
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options?.headers,
    };

    if (session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`;
    }

    const response = await fetch(fullUrl, {
      method,
      headers,
      ...options,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    if (response.status === 401) {
      // Handle logout
      if (typeof window !== 'undefined') {
        window.location.href = '/auth/login';
      }
    }

    const data = await response.json();

    if (!response.ok) {
      console.error(`[API Error] ${response.status}`, data);
      throw new Error(data?.message || 'API request failed');
    }

    return data;
  }

  get<T>(path: string, options?: RequestOptions) {
    return this.request<T>(path, 'GET', options);
  }

  post<T>(path: string, body?: any, options?: RequestOptions) {
    return this.request<T>(path, 'POST', { ...options, body });
  }

  put<T>(path: string, body?: any, options?: RequestOptions) {
    return this.request<T>(path, 'PUT', { ...options, body });
  }

  delete<T>(path: string, options?: RequestOptions) {
    return this.request<T>(path, 'DELETE', options);
  }

  patch<T>(path: string, body?: any, options?: RequestOptions) {
    return this.request<T>(path, 'PATCH', { ...options, body });
  }

  // Grouped endpoints
  auth = {
    login: (credentials: any) => this.post('/auth/login', credentials),
    logout: () => this.post('/auth/logout'),
  };

  contracts = {
    list: () => this.get<any[]>('/contracts'),
    create: (data: any) => this.post('/contracts', data),
    get: (id: string) => this.get(`/contracts/${id}`),
    update: (id: string, data: any) => this.put(`/contracts/${id}`, data),
    delete: (id: string) => this.delete(`/contracts/${id}`),
    analytics: () => this.get('/contracts/analytics/overview'),
  };

  invoices = {
    list: () => this.get<any[]>('/invoices'),
    create: (data: any) => this.post('/invoices', data),
    get: (id: string) => this.get(`/invoices/${id}`),
    update: (id: string, data: any) => this.put(`/invoices/${id}`, data),
    delete: (id: string) => this.delete(`/invoices/${id}`),
    compare: (data: any) => this.post('/invoices/compare', data),
    metrics: (consumerUnitId: string) =>
      this.get(`/invoices/metrics/${consumerUnitId}`),
  };

  consumerUnits = {
    list: () => this.get<any[]>('/consumer-units'),
    get: (id: string) => this.get(`/consumer-units/${id}`),
    create: (data: any) => this.post('/consumer-units', data),
    update: (id: string, data: any) => this.put(`/consumer-units/${id}`, data),
    delete: (id: string) => this.delete(`/consumer-units/${id}`),
  };

  settlements = {
    calculate: (data: any) => this.post('/settlements/calculate', data),
  };

  fees = {
    list: () => this.get('/fees'),
    create: (data: any) => this.post('/fees', data),
    update: (id: string, data: any) => this.put(`/fees/${id}`, data),
    delete: (id: string) => this.delete(`/fees/${id}`),
  };

  approvals = {
    list: () => this.get('/approvals'),
    create: (data: any) => this.post('/approvals', data),
    approve: (id: string) => this.post(`/approvals/${id}/approve`),
    reject: (id: string, reason: string) =>
      this.post(`/approvals/${id}/reject`, { reason }),
  };
}

export const api = new ApiClient();
export const apiClient = new ApiClient();
