'use client';

import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface RevenueChartProps {
  data: Array<{ month: string; revenue: number; fees: number }>;
}

export function RevenueChart({ data }: RevenueChartProps) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
      <h3 className="text-xl font-bold text-white mb-4">Receita por Mês</h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#444" />
          <XAxis dataKey="month" stroke="#999" />
          <YAxis stroke="#999" />
          <Tooltip 
            contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #555', borderRadius: '8px', color: '#fff' }}
          />
          <Legend />
          <Line type="monotone" dataKey="revenue" stroke="#ff6b6b" strokeWidth={2} name="Receita" />
          <Line type="monotone" dataKey="fees" stroke="#4ecdc4" strokeWidth={2} name="Honorários" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ContractDistributionChart({ data }: { data: Array<{ name: string; value: number }> }) {
  const COLORS = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#6c5ce7'];

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
      <h3 className="text-xl font-bold text-white mb-4">Distribuição por Tipo</h3>
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            labelLine={false}
            label={({ name, value }) => `${name}: ${value}`}
            outerRadius={100}
            fill="#8884d8"
            dataKey="value"
          >
            {data.map((_, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip 
            contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #555', borderRadius: '8px', color: '#fff' }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
