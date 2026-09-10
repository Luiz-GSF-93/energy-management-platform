'use client';

import { Card } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface SavingsChartProps {
  data: Array<{
    month: string;
    savings: number;
    originalCost: number;
    finalCost: number;
  }>;
  isLoading: boolean;
}

export function SavingsChart({ data, isLoading }: SavingsChartProps) {
  if (isLoading) {
    return <div className="text-center py-8">Carregando gráfico...</div>;
  }

  if (!data || data.length === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="text-gray-500">Sem dados de economia disponíveis</p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold mb-4">Economia ao Longo do Tempo</h2>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="month" />
          <YAxis />
          <Tooltip formatter={(value) => `R$ ${(value as number).toFixed(2)}`} />
          <Legend />
          <Line
            type="monotone"
            dataKey="savings"
            stroke="#10b981"
            name="Economia"
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="originalCost"
            stroke="#ef4444"
            name="Custo Original"
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="finalCost"
            stroke="#3b82f6"
            name="Custo Final"
            strokeWidth={2}
          />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}
