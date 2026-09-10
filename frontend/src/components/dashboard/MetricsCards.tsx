'use client';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DashboardMetrics } from '@/types';
import { TrendingUp, DollarSign, FileText, AlertCircle } from 'lucide-react';

interface MetricsCardsProps {
  metrics: DashboardMetrics;
  isLoading: boolean;
}

export function MetricsCards({ metrics, isLoading }: MetricsCardsProps) {
  if (isLoading) {
    return <div className="text-center py-8">Carregando métricas...</div>;
  }

  const cards = [
    {
      title: 'Economia Total',
      value: `R$ ${metrics.totalSavings.toFixed(2)}`,
      icon: TrendingUp,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
    },
    {
      title: 'Economia Média/Mês',
      value: `R$ ${metrics.averageSavingsPerMonth.toFixed(2)}`,
      icon: DollarSign,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      title: 'Total de Faturas',
      value: metrics.totalInvoices.toString(),
      icon: FileText,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
    },
    {
      title: 'Faturas Pendentes',
      value: metrics.pendingInvoices.toString(),
      icon: AlertCircle,
      color: 'text-orange-600',
      bgColor: 'bg-orange-50',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card, idx) => {
        const Icon = card.icon;
        return (
          <Card key={idx} className={`p-6 ${card.bgColor}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-2">{card.title}</p>
                <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
              </div>
              <Icon className={`w-12 h-12 ${card.color} opacity-20`} />
            </div>
          </Card>
        );
      })}
    </div>
  );
}
