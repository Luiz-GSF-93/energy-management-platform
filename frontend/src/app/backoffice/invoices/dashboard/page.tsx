'use client';

import { useState, useMemo } from 'react';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { TrendingUp, DollarSign, Percent, Activity } from 'lucide-react';

// Mock data - 12 meses de projeção
const mockMonthlyData = [
  { month: 'Jan', regulatedCost: 283200, aclCost: 254880, savings: 28320 },
  { month: 'Fev', regulatedCost: 280000, aclCost: 252000, savings: 28000 },
  { month: 'Mar', regulatedCost: 290000, aclCost: 261000, savings: 29000 },
  { month: 'Abr', regulatedCost: 275000, aclCost: 247500, savings: 27500 },
  { month: 'Mai', regulatedCost: 295000, aclCost: 265500, savings: 29500 },
  { month: 'Jun', regulatedCost: 305000, aclCost: 274500, savings: 30500 },
  { month: 'Jul', regulatedCost: 310000, aclCost: 279000, savings: 31000 },
  { month: 'Ago', regulatedCost: 308000, aclCost: 277200, savings: 30800 },
  { month: 'Set', regulatedCost: 300000, aclCost: 270000, savings: 30000 },
  { month: 'Out', regulatedCost: 292000, aclCost: 262800, savings: 29200 },
  { month: 'Nov', regulatedCost: 285000, aclCost: 256500, savings: 28500 },
  { month: 'Dez', regulatedCost: 315000, aclCost: 283500, savings: 31500 },
];

const costBreakdown = [
  { name: 'Energia', value: 150000 },
  { name: 'TUSD', value: 80000 },
  { name: 'Impostos', value: 35000 },
  { name: 'CCEE', value: 20000 },
];

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444'];

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-900 border border-slate-700 p-3 rounded text-white text-sm">
        <p>{`R$ ${(payload[0].value / 1000).toFixed(1)}k`}</p>
      </div>
    );
  }
  return null;
};

const CustomPieLabel = (entry: any) => {
  if (entry && entry.name && entry.percent !== undefined) {
    return `${entry.name} ${(entry.percent * 100).toFixed(0)}%`;
  }
  return '';
};

export default function DashboardPage() {
  const [period, setPeriod] = useState('all');
  const [selectedUc, setSelectedUc] = useState('all');

  const metrics = useMemo(() => {
    const total = mockMonthlyData.reduce((acc, m) => ({
      regulatedCost: acc.regulatedCost + m.regulatedCost,
      aclCost: acc.aclCost + m.aclCost,
      savings: acc.savings + m.savings,
    }), { regulatedCost: 0, aclCost: 0, savings: 0 });

    return {
      totalSavings: total.savings,
      totalRegulated: total.regulatedCost,
      totalAcl: total.aclCost,
      averageSavingsPercent: (total.savings / total.regulatedCost) * 100,
      averageMonthlySavings: total.savings / 12,
      roi: (total.savings / (1000 * 12)) * 100,
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">📊 Dashboard de Performance Energética</h1>
          <p className="text-slate-400">Visualize sua economia de energia e projeções</p>
        </div>

        {/* Filtros */}
        <div className="flex gap-4 mb-8">
          <select value={period} onChange={(e) => setPeriod(e.target.value)} className="px-4 py-2 bg-slate-800 border border-slate-700 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500">
            <option value="all">Todos os meses</option>
            <option value="3m">Últimos 3 meses</option>
            <option value="6m">Últimos 6 meses</option>
          </select>
          <select value={selectedUc} onChange={(e) => setSelectedUc(e.target.value)} className="px-4 py-2 bg-slate-800 border border-slate-700 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500">
            <option value="all">Todas as UCs</option>
            <option value="uc-001">UC-001</option>
            <option value="uc-002">UC-002</option>
          </select>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <p className="text-slate-400 text-sm">Economia Total (Anual)</p>
              <DollarSign className="text-green-500" size={20} />
            </div>
            <p className="text-3xl font-bold text-green-400">R$ {(metrics.totalSavings / 1000).toFixed(0)}k</p>
            <p className="text-xs text-slate-500 mt-2">+{metrics.averageSavingsPercent.toFixed(1)}% vs Regulado</p>
          </div>

          <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <p className="text-slate-400 text-sm">Economia Mensal (Média)</p>
              <TrendingUp className="text-blue-500" size={20} />
            </div>
            <p className="text-3xl font-bold text-blue-400">R$ {(metrics.averageMonthlySavings / 1000).toFixed(0)}k</p>
            <p className="text-xs text-slate-500 mt-2">Mensal</p>
          </div>

          <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <p className="text-slate-400 text-sm">% Economia</p>
              <Percent className="text-orange-500" size={20} />
            </div>
            <p className="text-3xl font-bold text-orange-400">{metrics.averageSavingsPercent.toFixed(1)}%</p>
            <p className="text-xs text-slate-500 mt-2">Média anual</p>
          </div>

          <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <p className="text-slate-400 text-sm">ROI</p>
              <Activity className="text-purple-500" size={20} />
            </div>
            <p className="text-3xl font-bold text-purple-400">{metrics.roi.toFixed(0)}%</p>
            <p className="text-xs text-slate-500 mt-2">Retorno anual</p>
          </div>
        </div>

        {/* Gráficos */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Linha: Economia Mensal */}
          <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
            <h3 className="text-lg font-bold text-white mb-4">📈 Economia Mensal (12 meses)</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={mockMonthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="month" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Line type="monotone" dataKey="savings" stroke="#10b981" name="Economia" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Barras: Regulado vs Livre */}
          <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
            <h3 className="text-lg font-bold text-white mb-4">⚖️ Regulado vs Mercado Livre</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={mockMonthlyData.slice(0, 6)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="month" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Bar dataKey="regulatedCost" name="Regulado" fill="#ef4444" />
                <Bar dataKey="aclCost" name="Mercado Livre" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Área: Acumulado */}
          <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
            <h3 className="text-lg font-bold text-white mb-4">📊 Acumulado Anual</h3>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={mockMonthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="month" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="savings" fill="#10b981" stroke="#059669" name="Economia Acumulada" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Pizza: Distribuição de Custos */}
          <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
            <h3 className="text-lg font-bold text-white mb-4">🍰 Distribuição de Custos ACL</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie 
                  data={costBreakdown} 
                  cx="50%" 
                  cy="50%" 
                  labelLine={false} 
                  label={CustomPieLabel}
                  outerRadius={80} 
                  fill="#8884d8" 
                  dataKey="value"
                >
                  {costBreakdown.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Tabela de Detalhes */}
        <div className="bg-slate-800 rounded-lg border border-slate-700 p-6">
          <h3 className="text-lg font-bold text-white mb-4">📋 Detalhes Mensais</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Mês</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-300">Regulado (R$)</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-300">Mercado Livre (R$)</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-300">Economia (R$)</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-300">% Economia</th>
                </tr>
              </thead>
              <tbody>
                {mockMonthlyData.map((row, index) => (
                  <tr key={index} className="border-b border-slate-700 hover:bg-slate-700/50 transition">
                    <td className="px-4 py-3 text-white font-medium">{row.month}</td>
                    <td className="px-4 py-3 text-right text-red-400">{(row.regulatedCost / 1000).toFixed(1)}k</td>
                    <td className="px-4 py-3 text-right text-blue-400">{(row.aclCost / 1000).toFixed(1)}k</td>
                    <td className="px-4 py-3 text-right text-green-400 font-semibold">{(row.savings / 1000).toFixed(1)}k</td>
                    <td className="px-4 py-3 text-right text-green-400 font-semibold">{((row.savings / row.regulatedCost) * 100).toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Resumo */}
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-700 p-4 rounded">
              <p className="text-slate-300 text-sm mb-1">Total Regulado (Anual)</p>
              <p className="text-2xl font-bold text-red-400">R$ {(metrics.totalRegulated / 1000000).toFixed(2)}M</p>
            </div>
            <div className="bg-slate-700 p-4 rounded">
              <p className="text-slate-300 text-sm mb-1">Total Mercado Livre (Anual)</p>
              <p className="text-2xl font-bold text-blue-400">R$ {(metrics.totalAcl / 1000000).toFixed(2)}M</p>
            </div>
            <div className="bg-slate-700 p-4 rounded">
              <p className="text-slate-300 text-sm mb-1">Economia Total (Anual)</p>
              <p className="text-2xl font-bold text-green-400">R$ {(metrics.totalSavings / 1000000).toFixed(2)}M</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
