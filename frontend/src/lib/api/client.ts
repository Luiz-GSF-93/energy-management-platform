const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface ApiResponse<T = any> {
  statusCode: number;
  message: string;
  data?: T;
  error?: string;
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    method: string,
    body?: any
  ): Promise<ApiResponse<T>> {
    try {
      const token =
        typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;

      const options: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
      };

      if (body) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(`${this.baseUrl}/api/v1${endpoint}`, options);

      if (response.status === 401) {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('auth_token');
          window.location.href = '/auth/login';
        }
      }

      const data = await response.json();
      return data as ApiResponse<T>;
    } catch (error: any) {
      return {
        statusCode: 500,
        message: error.message,
        error: 'Request failed',
      };
    }
  }

  post<T>(endpoint: string, body: any): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, 'POST', body);
  }

  get<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, 'GET');
  }

  put<T>(endpoint: string, body: any): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, 'PUT', body);
  }

  delete<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, 'DELETE');
  }

  patch<T>(endpoint: string, body: any): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, 'PATCH', body);
  }
}

const apiClient = new ApiClient(API_BASE_URL);

export const api = {
  // Métodos genéricos
  get: <T>(endpoint: string) => apiClient.get<T>(endpoint),
  post: <T>(endpoint: string, data: any) => apiClient.post<T>(endpoint, data),
  put: <T>(endpoint: string, data: any) => apiClient.put<T>(endpoint, data),
  delete: <T>(endpoint: string) => apiClient.delete<T>(endpoint),
  patch: <T>(endpoint: string, data: any) => apiClient.patch<T>(endpoint, data),

  auth: {
    login: (email: string, password: string) =>
      apiClient.post('/auth/login', { email, password }),
    logout: () => localStorage.removeItem('auth_token'),
  },

  contracts: {
    create: (data: any) => apiClient.post('/contracts', data),
    list: (params?: any) => apiClient.get('/contracts'),
    get: (id: string) => apiClient.get(`/contracts/${id}`),
    update: (id: string, data: any) => apiClient.put(`/contracts/${id}`, data),
    delete: (id: string) => apiClient.delete(`/contracts/${id}`),
    analytics: () => apiClient.get('/contracts/analytics/overview'),
  },

  invoices: {
    create: (data: any) => apiClient.post('/invoices', data),
    list: (params?: any) => apiClient.get('/invoices'),
    get: (id: string) => apiClient.get(`/invoices/${id}`),
    update: (id: string, data: any) => apiClient.put(`/invoices/${id}`, data),
    delete: (id: string) => apiClient.delete(`/invoices/${id}`),
    compare: (id: string, data: any) => apiClient.post(`/invoices/${id}/compare`, data),
    metrics: (consumerUnitId: string, params?: any) => 
      apiClient.get(`/invoices/metrics/${consumerUnitId}`),
  },

  consumerUnits: {
    list: () => apiClient.get('/consumer-units'),
    get: (id: string) => apiClient.get(`/consumer-units/${id}`),
    create: (data: any) => apiClient.post('/consumer-units', data),
    update: (id: string, data: any) => apiClient.put(`/consumer-units/${id}`, data),
    delete: (id: string) => apiClient.delete(`/consumer-units/${id}`),
  },

  settlements: {
    calculate: (data: any) => apiClient.post('/settlements/calculate', data),
  },

  fees: {
    create: (data: any) => apiClient.post('/fees', data),
    list: () => apiClient.get('/fees'),
    get: (id: string) => apiClient.get(`/fees/${id}`),
    update: (id: string, data: any) => apiClient.put(`/fees/${id}`, data),
    delete: (id: string) => apiClient.delete(`/fees/${id}`),
  },

  approvals: {
    create: (data: any) => apiClient.post('/approvals', data),
    list: () => apiClient.get('/approvals'),
    get: (id: string) => apiClient.get(`/approvals/${id}`),
    approve: (id: string) => apiClient.put(`/approvals/${id}/approve`, {}),
    reject: (id: string) => apiClient.put(`/approvals/${id}/reject`, {}),
  },
};

export { apiClient };
