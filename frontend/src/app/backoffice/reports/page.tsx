"use client";

import { useState, useEffect } from 'react';
import { BarChart3, Download } from 'lucide-react';

export default function ReportsPage() {
  const [reportData, setReportData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchReport = async () => {
      try {
        const token = localStorage.getItem('auth_token');
        const response = await fetch('https://energy-management-platform.onrender.com/api/v1/backoffice/revenue-report', {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) throw new Error('Falha ao carregar relatório');
        
        const data = await response.json();
        setReportData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao carregar relatório');
      } finally {
        setLoading(false);
      }
    };

    fetchReport();
  }, []);

  if (loading) {
    return (
      <div className="p-6 flex justify-center items-center h-full">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-400">Gerando relatório...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-2">
            <BarChart3 className="w-8 h-8 text-orange-400" />
            Relatórios
          </h1>
          <p className="text-gray-400 mt-1">Análise de receita e desempenho</p>
        </div>
        <button className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition">
          <Download className="w-5 h-5" />
          Exportar
        </button>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-700 rounded-lg p-4 text-red-400">
          {error}
        </div>
      )}

      {reportData && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-gradient-to-br from-blue-900/40 to-blue-900/20 border border-blue-700 rounded-lg p-6">
            <p className="text-blue-300 text-sm font-medium">Total de Receita</p>
            <p className="text-3xl font-bold text-white mt-2">
              R$ {(reportData.totalRevenue || 0).toFixed(2)}
            </p>
          </div>
          <div className="bg-gradient-to-br from-green-900/40 to-green-900/20 border border-green-700 rounded-lg p-6">
            <p className="text-green-300 text-sm font-medium">Honorários Pagos</p>
            <p className="text-3xl font-bold text-white mt-2">
              R$ {(reportData.paidFees || 0).toFixed(2)}
            </p>
          </div>
          <div className="bg-gradient-to-br from-yellow-900/40 to-yellow-900/20 border border-yellow-700 rounded-lg p-6">
            <p className="text-yellow-300 text-sm font-medium">Pendentes</p>
            <p className="text-3xl font-bold text-white mt-2">
              R$ {(reportData.pendingFees || 0).toFixed(2)}
            </p>
          </div>
        </div>
      )}

      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6">
        <h2 className="text-xl font-bold text-white mb-4">Detalhes do Relatório</h2>
        <pre className="text-gray-300 text-xs overflow-auto max-h-96">
          {JSON.stringify(reportData, null, 2)}
        </pre>
      </div>
    </div>
  );
}
