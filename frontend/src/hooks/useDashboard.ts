'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/services/api';
import { Invoice, SavingsData, DashboardMetrics } from '@/types';

export function useDashboard() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [savingsData, setSavingsData] = useState<SavingsData[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    totalSavings: 0,
    averageSavingsPerMonth: 0,
    totalInvoices: 0,
    pendingInvoices: 0,
    currentMonthSavings: 0,
    lastMonthSavings: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Buscar faturas
      const invoicesResponse = await apiClient.getInvoices();
      if (invoicesResponse.success && invoicesResponse.data) {
        setInvoices(invoicesResponse.data);
      }

      // Buscar relatório de resumo
      const reportResponse = await apiClient.getSummaryReport('month');
      if (reportResponse.success && reportResponse.data?.financialMetrics) {
        const financialData = reportResponse.data.financialMetrics;
        setMetrics({
          totalSavings: financialData.totalSavings || 0,
          averageSavingsPerMonth: financialData.averageSavings || 0,
          totalInvoices: invoicesResponse.count || 0,
          pendingInvoices: invoicesResponse.data?.filter((inv: Invoice) => inv.status === 'pending').length || 0,
          currentMonthSavings: financialData.currentMonthSavings || 0,
          lastMonthSavings: financialData.lastMonthSavings || 0,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar dados');
      console.error('Dashboard error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return {
    invoices,
    savingsData,
    metrics,
    isLoading,
    error,
    refetch: fetchDashboardData,
  };
}
