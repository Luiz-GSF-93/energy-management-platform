'use client';

import { useAuth } from '@/context/AuthContext';
import { useDashboard } from '@/hooks/useDashboard';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { MetricsCards } from '@/components/dashboard/MetricsCards';
import { InvoicesList } from '@/components/dashboard/InvoicesList';
import { SavingsChart } from '@/components/dashboard/SavingsChart';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function DashboardPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const { metrics, invoices, isLoading: dataLoading } = useDashboard();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/auth/login');
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-screen">Carregando...</div>;
  }

  const chartData = [
    { month: 'Set', savings: 1500, originalCost: 2500, finalCost: 1000 },
    { month: 'Out', savings: 1800, originalCost: 2600, finalCost: 800 },
    { month: 'Nov', savings: 2100, originalCost: 2700, finalCost: 600 },
  ];

  return (
    <div className="flex">
      <Sidebar />
      <div className="flex-1 bg-gray-50">
        <Header />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-8">
            <h2 className="text-3xl font-bold text-gray-900">Dashboard</h2>
            <p className="text-gray-600 mt-2">Bem-vindo ao seu painel de controle de energia</p>
          </div>

          <div className="space-y-8">
            <MetricsCards metrics={metrics} isLoading={dataLoading} />
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2">
                <SavingsChart data={chartData} isLoading={dataLoading} />
              </div>
              <div>
                <InvoicesList invoices={invoices} isLoading={dataLoading} />
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
