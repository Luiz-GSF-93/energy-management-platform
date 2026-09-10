'use client';

import { Card } from '@/components/ui/card';

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
      <div className="space-y-4">
        {data.map((item, idx) => (
          <div key={idx} className="flex justify-between items-center p-4 border-b">
            <span className="font-medium">{item.month}</span>
            <div className="text-right">
              <p className="text-green-600 font-semibold">R$ {item.savings.toFixed(2)}</p>
              <p className="text-sm text-gray-500">Economia</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
