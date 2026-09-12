interface RequestOptions extends RequestInit {
  params?: Record<string, any>;
}

class ApiClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    this.baseUrl = this.baseUrl.replace(/\/api\/v1\/?$/, '');
  }

  private async request<T>(
    path: string,
    method: string = 'GET',
    options?: RequestOptions
  ): Promise<T> {
    let url = path.startsWith('/') ? path : `/${path}`;
    if (!url.includes('/api/v1')) {
      url = `/api/v1${url}`;
    }

    const fullUrl = `${this.baseUrl}${url}`;
    console.log(`[API] ${method} ${fullUrl}`);

    const headers: any = {
      'Content-Type': 'application/json',
    };

    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('auth_token');
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    const response = await fetch(fullUrl, {
      method,
      headers,
      ...(options || {}),
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    if (response.status === 401) {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('auth_token');
        window.location.href = '/auth/login';
      }
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error(`[API Error] ${response.status}`, data);
      throw new Error((data as any)?.message || 'API request failed');
    }

    return data as T;
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

  auth = {
    login: (credentials: any) => this.post('/auth/login', credentials),
    logout: () => this.post('/auth/logout'),
  };

  contracts = {
    list: () => this.get<any[]>('/contracts'),
    create: (data: any) => this.post<any>('/contracts', data),
    get: (id: string) => this.get<any>(`/contracts/${id}`),
    update: (id: string, data: any) => this.put<any>(`/contracts/${id}`, data),
    delete: (id: string) => this.delete<any>(`/contracts/${id}`),
    analytics: () => this.get<any>('/contracts/analytics/overview'),
  };

  invoices = {
    list: () => this.get<any[]>('/invoices'),
    create: (data: any) => this.post<any>('/invoices', data),
    get: (id: string) => this.get<any>(`/invoices/${id}`),
    update: (id: string, data: any) => this.put<any>(`/invoices/${id}`, data),
    delete: (id: string) => this.delete<any>(`/invoices/${id}`),
    compare: (data: any) => this.post<any>('/invoices/compare', data),
    metrics: (consumerUnitId: string) => this.get<any>(`/invoices/metrics/${consumerUnitId}`),
  };

  consumerUnits = {
    list: () => this.get<any[]>('/consumer-units'),
    get: (id: string) => this.get<any>(`/consumer-units/${id}`),
    create: (data: any) => this.post<any>('/consumer-units', data),
    update: (id: string, data: any) => this.put<any>(`/consumer-units/${id}`, data),
    delete: (id: string) => this.delete<any>(`/consumer-units/${id}`),
  };

  settlements = {
    calculate: (data: any) => this.post<any>('/settlements/calculate', data),
  };

  fees = {
    list: () => this.get<any>('/fees'),
    create: (data: any) => this.post<any>('/fees', data),
    update: (id: string, data: any) => this.put<any>(`/fees/${id}`, data),
    delete: (id: string) => this.delete<any>(`/fees/${id}`),
  };

  approvals = {
    list: () => this.get<any>('/approvals'),
    create: (data: any) => this.post<any>('/approvals', data),
    approve: (id: string) => this.post<any>(`/approvals/${id}/approve`),
    reject: (id: string, reason: string) => this.post<any>(`/approvals/${id}/reject`, { reason }),
  };
}

export const api = new ApiClient();
export const apiClient = new ApiClient();
