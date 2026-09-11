'use client';

import { useState, useEffect } from 'react';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { TrendingUp, DollarSign, Zap, Target } from 'lucide-react';

interface PerformanceMetrics {
  period: string;
  consumption: number;
  regulatedCost: number;
  freeMarketCost: number;
  savings: number;
  savingsPercentage: number;
  roi: number;
}

export default function InvoiceDashboardPage() {
  const [metrics, setMetrics] = useState<PerformanceMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState({
    totalSavings: 0,
    savingsPercentage: 0,
    totalConsumption: 0,
    averageRoi: 0,
  });

  useEffect(() => {
    // Simulando dados
    const mockData: PerformanceMetrics[] = [
      { period: '2026-01-01', consumption: 1200, regulatedCost: 2400, freeMarketCost: 2100, savings: 300, savingsPercentage: 12.5, roi: 14.3 },
      { period: '2026-02-01', consumption: 1350, regulatedCost: 2700, freeMarketCost: 2380, savings: 320, savingsPercentage: 11.9, roi: 13.4 },
      { period: '2026-03-01', consumption: 1100, regulatedCost: 2200, freeMarketCost: 1980, savings: 220, savingsPercentage: 10.0, roi: 11.1 },
      { period: '2026-04-01', consumption: 1450, regulatedCost: 2900, freeMarketCost: 2500, savings: 400, savingsPercentage: 13.8, roi: 16.0 },
      { period: '2026-05-01', consumption: 1550, regulatedCost: 3100, freeMarketCost: 2600, savings: 500, savingsPercentage: 16.1, roi: 19.2 },
      { period: '2026-06-01', consumption: 1300, regulatedCost: 2600, freeMarketCost: 2250, savings: 350, savingsPercentage: 13.5, roi: 15.6 },
    ];

    setMetrics(mockData);

    const totalSavings = mockData.reduce((sum, m) => sum + m.savings, 0);
    const avgSavingsPerc = mockData.reduce((sum, m) => sum + m.savingsPercentage, 0) / mockData.length;
    const totalConsumption = mockData.reduce((sum, m) => sum + m.consumption, 0);
    const avgRoi = mockData.reduce((sum, m) => sum + m.roi, 0) / mockData.length;

    setKpis({
      totalSavings,
      savingsPercentage: avgSavingsPerc,
      totalConsumption,
      averageRoi: avgRoi,
    });

    setLoading(false);
  }, []);

  const COLORS = ['#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6'];
  
  const costDistribution = [
    { name: 'TUSD', value: 35 },
    { name: 'TE', value: 25 },
    { name: 'Demanda', value: 20 },
    { name: 'Impostos', value: 15 },
    { name: 'Encargos', value: 5 },
  ];

  if (loading) {
    return (
      <div className="text-center py-12 bg-slate-800 rounded-lg shadow-lg border border-slate-700 m-6">
        <div className="inline-block">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600"></div>
        </div>
        <p className="text-slate-400 mt-4">Carregando dashboard...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-white">📊 Dashboard de Performance</h1>
        <p className="text-slate-400 mt-1">Análise de economia e consumo energético</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-green-900/30 to-green-800/20 p-6 rounded-lg shadow-lg border border-green-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-green-300 text-sm font-medium">Economia Total</p>
              <p className="text-3xl font-bold text-green-400 mt-2">
                R$ {kpis.totalSavings.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
              </p>
              <p className="text-green-300 text-xs mt-2">{kpis.savingsPercentage.toFixed(1)}% de economia média</p>
            </div>
            <DollarSign size={40} className="text-green-500 opacity-50" />
          </div>
        </div>

        <div className="bg-gradient-to-br from-blue-900/30 to-blue-800/20 p-6 rounded-lg shadow-lg border border-blue-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-300 text-sm font-medium">Consumo Total</p>
              <p className="text-3xl font-bold text-blue-400 mt-2">
                {kpis.totalConsumption.toLocaleString('pt-BR')} kWh
              </p>
              <p className="text-blue-300 text-xs mt-2">Período selecionado</p>
            </div>
            <Zap size={40} className="text-blue-500 opacity-50" />
          </div>
        </div>

        <div className="bg-gradient-to-br from-purple-900/30 to-purple-800/20 p-6 rounded-lg shadow-lg border border-purple-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-purple-300 text-sm font-medium">ROI Médio</p>
              <p className="text-3xl font-bold text-purple-400 mt-2">
                {kpis.averageRoi.toFixed(1)}%
              </p>
              <p className="text-purple-300 text-xs mt-2">Retorno sobre investimento</p>
            </div>
            <TrendingUp size={40} className="text-purple-500 opacity-50" />
          </div>
        </div>

        <div className="bg-gradient-to-br from-orange-900/30 to-orange-800/20 p-6 rounded-lg shadow-lg border border-orange-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-orange-300 text-sm font-medium">Economia %</p>
              <p className="text-3xl font-bold text-orange-400 mt-2">
                {kpis.savingsPercentage.toFixed(2)}%
              </p>
              <p className="text-orange-300 text-xs mt-2">Média do período</p>
            </div>
            <Target size={40} className="text-orange-500 opacity-50" />
          </div>
        </div>
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LineChart: Economia Mensal */}
        <div className="bg-slate-800 p-6 rounded-lg shadow-lg border border-slate-700">
          <h2 className="text-xl font-bold text-white mb-4">💰 Economia Mensal (R$)</h2>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={metrics}>
              <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
              <XAxis dataKey="period" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }} />
              <Legend />
              <Line type="monotone" dataKey="savings" stroke="#10b981" strokeWidth={3} name="Economia (R$)" dot={{ fill: '#10b981', r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* BarChart: Regulado vs Mercado Livre */}
        <div className="bg-slate-800 p-6 rounded-lg shadow-lg border border-slate-700">
          <h2 className="text-xl font-bold text-white mb-4">📊 Regulado vs Mercado Livre</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={metrics}>
              <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
              <XAxis dataKey="period" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }} />
              <Legend />
              <Bar dataKey="regulatedCost" fill="#ef4444" name="Regulado" />
              <Bar dataKey="freeMarketCost" fill="#10b981" name="Mercado Livre" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* PieChart: Distribuição de Custos */}
        <div className="bg-slate-800 p-6 rounded-lg shadow-lg border border-slate-700">
          <h2 className="text-xl font-bold text-white mb-4">🥧 Distribuição de Custos</h2>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie data={costDistribution} cx="50%" cy="50%" labelLine={false} label={({ name, value }) => `${name} ${value}%`} outerRadius={80} fill="#8884d8" dataKey="value">
                {costDistribution.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* AreaChart: Projeção Anual */}
        <div className="bg-slate-800 p-6 rounded-lg shadow-lg border border-slate-700">
          <h2 className="text-xl font-bold text-white mb-4">📈 Projeção de Economia Anual</h2>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={metrics}>
              <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
              <XAxis dataKey="period" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }} />
              <Legend />
              <Area type="monotone" dataKey="savingsPercentage" fill="#10b981" stroke="#059669" strokeWidth={2} name="Economia %" fillOpacity={0.6} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Tabela de Detalhes */}
      <div className="bg-slate-800 rounded-lg shadow-lg overflow-hidden border border-slate-700">
        <div className="p-6 border-b border-slate-700">
          <h2 className="text-xl font-bold text-white">📋 Detalhes Mensais</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-900 border-b border-slate-700">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Período</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Consumo (kWh)</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Regulado</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Mercado Livre</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Economia</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">% Economia</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">ROI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {metrics.map((metric, index) => (
                <tr key={index} className="hover:bg-slate-700 transition">
                  <td className="px-6 py-4 text-sm text-slate-300">{metric.period}</td>
                  <td className="px-6 py-4 text-sm text-slate-300">{metric.consumption.toLocaleString('pt-BR')}</td>
                  <td className="px-6 py-4 text-sm text-red-400">R$ {metric.regulatedCost.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                  <td className="px-6 py-4 text-sm text-green-400">R$ {metric.freeMarketCost.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                  <td className="px-6 py-4 text-sm font-bold text-emerald-400">R$ {metric.savings.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                  <td className="px-6 py-4 text-sm font-bold text-emerald-400">{metric.savingsPercentage.toFixed(2)}%</td>
                  <td className="px-6 py-4 text-sm font-bold text-blue-400">{metric.roi.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
