'use client';

import { useState, useMemo } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
} from 'recharts';
import { TrendingUp, DollarSign, Percent, Activity } from 'lucide-react';

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

export default function DashboardPage() {
  const [period, setPeriod] = useState('2026');

  const metrics = useMemo(() => {
    const totalRegulated = mockMonthlyData.reduce((sum, m) => sum + m.regulatedCost, 0);
    const totalAcl = mockMonthlyData.reduce((sum, m) => sum + m.aclCost, 0);
    const totalSavings = mockMonthlyData.reduce((sum, m) => sum + m.savings, 0);
    const avgSavings = totalSavings / mockMonthlyData.length;

    return {
      totalSavings,
      avgSavings,
      savingsPercent: ((totalSavings / totalRegulated) * 100).toFixed(2),
      roi: ((totalSavings / 50000) * 100).toFixed(2),
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-bold text-white mb-8">Dashboard</h1>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-400 text-sm">Economia Total</p>
                <p className="text-green-400 text-2xl font-bold">
                  R$ {(metrics.totalSavings / 1000).toFixed(0)}k
                </p>
              </div>
              <DollarSign size={32} className="text-green-400/30" />
            </div>
          </div>

          <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-400 text-sm">Média Mensal</p>
                <p className="text-blue-400 text-2xl font-bold">
                  R$ {(metrics.avgSavings / 1000).toFixed(0)}k
                </p>
              </div>
              <TrendingUp size={32} className="text-blue-400/30" />
            </div>
          </div>

          <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-400 text-sm">% Economia</p>
                <p className="text-yellow-400 text-2xl font-bold">{metrics.savingsPercent}%</p>
              </div>
              <Percent size={32} className="text-yellow-400/30" />
            </div>
          </div>

          <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-400 text-sm">ROI</p>
                <p className="text-purple-400 text-2xl font-bold">{metrics.roi}%</p>
              </div>
              <Activity size={32} className="text-purple-400/30" />
            </div>
          </div>
        </div>

        <div className="bg-slate-800 rounded-lg border border-slate-700 p-6 mb-8">
          <h2 className="text-xl font-bold text-white mb-4">Economia Mensal</h2>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={mockMonthlyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="savings" stroke="#10b981" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-slate-800 rounded-lg border border-slate-700 p-6">
          <h2 className="text-xl font-bold text-white mb-4">Comparação</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={mockMonthlyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="regulatedCost" fill="#3b82f6" />
              <Bar dataKey="aclCost" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
