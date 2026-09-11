'use client';

import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, FileText, AlertCircle, DollarSign, Zap, ChevronRight } from 'lucide-react';
import Link from 'next/link';

export default function DashboardHome() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [kpis, setKpis] = useState({
    totalSavings: 0,
    totalInvoices: 0,
    avgConsumption: 1250,
    alerts: 2,
    savingsChange: 12.5,
    consumptionChange: -3.2,
    thisMonthCost: 0,
    projectedSavings: 0
  });

  useEffect(() => {
    setTimeout(() => {
      setKpis({
        totalSavings: 2847.50,
        totalInvoices: 12,
        avgConsumption: 1250,
        alerts: 2,
        savingsChange: 12.5,
        consumptionChange: -3.2,
        thisMonthCost: 487.92,
        projectedSavings: 562.34
      });
      setInvoices([
        { id: 1, month: 'Setembro', amount: 487.92, status: 'paga', consumption: 1250 },
        { id: 2, month: 'Agosto', amount: 512.45, status: 'paga', consumption: 1380 },
        { id: 3, month: 'Julho', amount: 498.34, status: 'paga', consumption: 1200 }
      ]);
      setLoading(false);
    }, 1000);
  }, []);

  const StatCard = ({ title, value, unit, icon: Icon, change, changeType = 'positive' }: any) => (
    <div className="relative group h-40">
      <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-white/5 rounded-xl backdrop-blur-md border border-white/10 group-hover:border-white/20 transition-all duration-300"></div>
      
      <div className="relative p-4 sm:p-6 flex flex-col justify-between h-full">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-gray-400 text-xs sm:text-sm font-medium mb-2">{title}</p>
            <div className="flex items-baseline gap-2">
              <span className="text-xl sm:text-3xl font-bold text-white">{value}</span>
              <span className="text-gray-500 text-xs sm:text-sm">{unit}</span>
            </div>
          </div>
          <div className={`p-2 sm:p-3 rounded-lg ${
            changeType === 'positive' 
              ? 'bg-green-500/20' 
              : changeType === 'negative'
              ? 'bg-red-500/20'
              : 'bg-blue-500/20'
          }`}>
            <Icon className={`w-4 sm:w-5 h-4 sm:h-5 ${
              changeType === 'positive' 
                ? 'text-green-400' 
                : changeType === 'negative'
                ? 'text-red-400'
                : 'text-blue-400'
            }`} />
          </div>
        </div>
        
        {change !== undefined && (
          <div className="flex items-center gap-1 mt-2 sm:mt-4">
            {changeType === 'positive' ? (
              <TrendingUp className="w-3 sm:w-4 h-3 sm:h-4 text-green-400" />
            ) : (
              <TrendingDown className="w-3 sm:w-4 h-3 sm:h-4 text-red-400" />
            )}
            <span className={`text-xs sm:text-sm font-semibold ${
              changeType === 'positive' 
                ? 'text-green-400' 
                : 'text-red-400'
            }`}>
              {Math.abs(change)}%
            </span>
            <span className="text-gray-400 text-xs">vs. mês anterior</span>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="p-6 sm:p-8 bg-gray-950 min-h-full">
      {/* Welcome Section */}
      <div className="mb-8">
        <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">
          Bem-vindo de volta! 👋
        </h2>
        <p className="text-gray-400 text-sm sm:text-base">Aqui está um resumo do seu consumo e economia.</p>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6 mb-8">
        <StatCard 
          title="Economia Total"
          value={`R$ ${kpis.totalSavings.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`}
          unit=""
          icon={TrendingUp}
          change={kpis.savingsChange}
          changeType="positive"
        />
        
        <StatCard 
          title="Total de Faturas"
          value={kpis.totalInvoices}
          unit="faturas"
          icon={FileText}
          changeType="neutral"
        />
        
        <StatCard 
          title="Consumo Médio"
          value={kpis.avgConsumption}
          unit="kWh"
          icon={Zap}
          change={kpis.consumptionChange}
          changeType="positive"
        />
        
        <StatCard 
          title="Alertas Ativos"
          value={kpis.alerts}
          unit="itens"
          icon={AlertCircle}
          changeType="neutral"
        />
      </div>

      {/* Secondary Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-8">
        {/* Cost This Month */}
        <div className="relative group">
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-white/5 rounded-xl backdrop-blur-md border border-white/10 group-hover:border-white/20 transition-all duration-300"></div>
          <div className="relative p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-gray-300 font-semibold text-sm sm:text-base">Custo Este Mês</h3>
              <DollarSign className="w-5 h-5 text-blue-400" />
            </div>
            <div className="text-2xl sm:text-4xl font-bold text-white mb-2">
              R$ {kpis.thisMonthCost.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
            </div>
            <p className="text-gray-400 text-xs sm:text-sm">Setembro de 2026</p>
          </div>
        </div>

        {/* Projected Savings */}
        <div className="relative group">
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-white/5 rounded-xl backdrop-blur-md border border-white/10 group-hover:border-white/20 transition-all duration-300"></div>
          <div className="relative p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-gray-300 font-semibold text-sm sm:text-base">Economia Projetada</h3>
              <TrendingUp className="w-5 h-5 text-green-400" />
            </div>
            <div className="text-2xl sm:text-4xl font-bold text-white mb-2">
              R$ {kpis.projectedSavings.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
            </div>
            <p className="text-gray-400 text-xs sm:text-sm">Próximos 30 dias</p>
          </div>
        </div>
      </div>

      {/* Recent Invoices */}
      <div className="relative group">
        <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-white/5 rounded-xl backdrop-blur-md border border-white/10 group-hover:border-white/20 transition-all duration-300"></div>
        <div className="relative p-4 sm:p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-base sm:text-lg font-semibold text-white">Faturas Recentes</h3>
            <Link href="/dashboard/invoices" className="text-orange-400 hover:text-orange-300 text-xs sm:text-sm font-medium flex items-center gap-1">
              Ver tudo <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          
          {invoices.length === 0 ? (
            <p className="text-gray-400 text-sm">Nenhuma fatura disponível</p>
          ) : (
            <div className="space-y-3">
              {invoices.map((invoice) => (
                <div key={invoice.id} className="flex items-center justify-between py-2 sm:py-3 px-3 sm:px-4 bg-white/5 hover:bg-white/10 rounded-lg transition-colors border border-white/5">
                  <div className="flex items-center gap-3 sm:gap-4">
                    <div className="w-8 sm:w-10 h-8 sm:h-10 rounded-lg bg-gradient-to-br from-blue-500/30 to-blue-600/20 flex items-center justify-center">
                      <FileText className="w-4 sm:w-5 h-4 sm:h-5 text-blue-400" />
                    </div>
                    <div>
                      <p className="text-white font-medium text-xs sm:text-sm">{invoice.month}</p>
                      <p className="text-gray-400 text-xs">{invoice.consumption} kWh</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-white font-semibold text-xs sm:text-sm">R$ {invoice.amount.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
                    <span className="text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded-full">{invoice.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
