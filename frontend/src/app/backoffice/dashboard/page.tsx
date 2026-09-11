'use client';

import { useEffect, useState } from 'react';
import { BarChart3, Users, FileText, CheckCircle, TrendingUp, AlertCircle } from 'lucide-react';

interface DashboardData {
  contracts: any;
  fees: any;
  approvals: any;
  users: any;
  timestamp: string;
}

export default function BackofficeDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const token = localStorage.getItem('auth_token');
        const response = await fetch(
          'https://energy-management-platform.onrender.com/api/v1/backoffice/dashboard',
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (!response.ok) throw new Error('Erro ao carregar dashboard');
        const result = await response.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro desconhecido');
      } finally {
        setLoading(false);
      }
    };

    fetchDashboard();
  }, []);

  if (loading) return <div className="text-center py-12 text-slate-400">Carregando...</div>;
  if (error) return <div className="text-center py-12 text-red-400">{error}</div>;
  if (!data) return null;

  const kpis = [
    {
      title: 'Contratos Ativos',
      value: data.contracts.active,
      total: data.contracts.total,
      icon: FileText,
      color: 'bg-blue-500',
    },
    {
      title: 'Honorários Pendentes',
      value: data.fees.pending,
      total: data.fees.total,
      icon: BarChart3,
      color: 'bg-yellow-500',
    },
    {
      title: 'Aprovações Pendentes',
      value: data.approvals.pending,
      total: data.approvals.total,
      icon: CheckCircle,
      color: 'bg-purple-500',
    },
    {
      title: 'Total de Usuários',
      value: data.users?.totalUsers || 0,
      icon: Users,
      color: 'bg-green-500',
    },
  ];

  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-8">Dashboard Executivo</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {kpis.map((kpi, idx) => {
          const Icon = kpi.icon;
          return (
            <div
              key={idx}
              className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-lg p-6 backdrop-blur"
            >
              <div className="flex items-center justify-between mb-4">
                <p className="text-slate-400 text-sm">{kpi.title}</p>
                <div className={`${kpi.color} p-2 rounded-lg`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
              </div>
              <p className="text-3xl font-bold text-white">{kpi.value}</p>
              {kpi.total && (
                <p className="text-slate-500 text-xs mt-2">
                  de {kpi.total} total
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Financial Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-lg p-6 backdrop-blur">
          <h2 className="text-xl font-bold text-white mb-4">Resumo Financeiro</h2>
          <div className="space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-700">
              <p className="text-slate-400">Honorários Total</p>
              <p className="text-2xl font-bold text-green-400">
                R$ {Number(data.fees.totalAmount).toLocaleString('pt-BR', {
                  minimumFractionDigits: 2,
                })}
              </p>
            </div>
            <div className="flex justify-between items-center pb-2 border-b border-slate-700">
              <p className="text-slate-400">Fee Médio</p>
              <p className="text-lg font-semibold text-blue-400">
                R$ {(Number(data.fees.totalAmount) / (data.fees.total || 1)).toLocaleString('pt-BR', {
                  minimumFractionDigits: 2,
                })}
              </p>
            </div>
            <div className="flex justify-between items-center">
              <p className="text-slate-400">Última Atualização</p>
              <p className="text-sm text-slate-500">
                {new Date(data.timestamp).toLocaleString('pt-BR')}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-lg p-6 backdrop-blur">
          <h2 className="text-xl font-bold text-white mb-4">Status dos Contratos</h2>
          <div className="space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-700">
              <p className="text-slate-400">Ativos</p>
              <p className="text-lg font-bold text-green-400">{data.contracts.active}</p>
            </div>
            <div className="flex justify-between items-center pb-2 border-b border-slate-700">
              <p className="text-slate-400">Inativos</p>
              <p className="text-lg font-bold text-red-400">{data.contracts.inactive}</p>
            </div>
            <div className="flex justify-between items-center">
              <p className="text-slate-400">Taxa de Atividade</p>
              <p className="text-lg font-bold text-blue-400">
                {Math.round((data.contracts.active / data.contracts.total) * 100)}%
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
