import axios, { AxiosInstance, AxiosError } from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://energy-management-platform.onrender.com/api/v1';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  count?: number;
  message?: string;
}

class ApiClient {
  private client: AxiosInstance;
  private token: string | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Interceptor para adicionar token JWT
    this.client.interceptors.request.use((config) => {
      if (this.token) {
        config.headers.Authorization = `Bearer ${this.token}`;
      }
      return config;
    });

    // Interceptor para tratamento de erros
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response?.status === 401) {
          this.clearToken();
        }
        return Promise.reject(error);
      }
    );
  }

  setToken(token: string) {
    this.token = token;
  }

  clearToken() {
    this.token = null;
  }

  // Auth endpoints
  async login(email: string, password: string): Promise<ApiResponse<{ access_token: string }>> {
    const response = await this.client.post('/auth/login', { email, password });
    return response.data;
  }

  // Invoices endpoints
  async getInvoices(): Promise<ApiResponse<any>> {
    const response = await this.client.get('/invoices');
    return response.data;
  }

  async getInvoiceById(id: string): Promise<ApiResponse<any>> {
    const response = await this.client.get(`/invoices/${id}`);
    return response.data;
  }

  async createInvoice(data: any): Promise<ApiResponse<any>> {
    const response = await this.client.post('/invoices', data);
    return response.data;
  }

  async simulateRegulatedMarket(data: any): Promise<ApiResponse<any>> {
    const response = await this.client.post('/invoices/simulate/regulated-market', data);
    return response.data;
  }

  // Management fees endpoints
  async compareFeesScenarios(data: any): Promise<ApiResponse<any>> {
    const response = await this.client.post('/management-fees/compare-scenarios', data);
    return response.data;
  }

  async listManagementFees(): Promise<ApiResponse<any>> {
    const response = await this.client.get('/management-fees');
    return response.data;
  }

  // Audit logs
  async getAuditLogs(): Promise<ApiResponse<any>> {
    const response = await this.client.get('/audit/logs');
    return response.data;
  }

  // Reports
  async getSummaryReport(period: string): Promise<ApiResponse<any>> {
    const response = await this.client.get(`/reports/summary?period=${period}`);
    return response.data;
  }
}

export const apiClient = new ApiClient();
