'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { 
  LogOut, 
  Menu, 
  X,
  Bell, 
  Settings, 
  TrendingUp, 
  TrendingDown,
  FileText, 
  AlertCircle, 
  DollarSign, 
  Zap,
  BarChart3,
  PieChart,
  Home,
  ReceiptText,
  Brain,
  Cog,
  ChevronRight
} from 'lucide-react';

export default function DashboardHome() {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [notificationCount, setNotificationCount] = useState(2);

  // KPI Data
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
    const token = localStorage.getItem('authToken');
    const userStr = localStorage.getItem('user');
    
    if (!token) {
      router.push('/auth/login');
      return;
    }

    if (userStr) {
      setUser(JSON.parse(userStr));
    }

    // Simular carregamento de dados
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
      setIsLoading(false);
    }, 1000);
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('authToken');
    localStorage.removeItem('user');
    router.push('/auth/login');
  };

  const StatCard = ({ title, value, unit, icon: Icon, change, changeType = 'positive' }: any) => (
    <div className="relative group">
      {/* Glassmorphism Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-white/5 rounded-xl backdrop-blur-md border border-white/10 group-hover:border-white/20 transition-all duration-300"></div>
      
      {/* Content */}
      <div className="relative p-6 flex flex-col justify-between h-full">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-gray-400 text-sm font-medium mb-2">{title}</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-white">{value}</span>
              <span className="text-gray-500 text-sm">{unit}</span>
            </div>
          </div>
          <div className={`p-3 rounded-lg ${
            changeType === 'positive' 
              ? 'bg-green-500/20' 
              : changeType === 'negative'
              ? 'bg-red-500/20'
              : 'bg-blue-500/20'
          }`}>
            <Icon className={`w-5 h-5 ${
              changeType === 'positive' 
                ? 'text-green-400' 
                : changeType === 'negative'
                ? 'text-red-400'
                : 'text-blue-400'
            }`} />
          </div>
        </div>
        
        {change !== undefined && (
          <div className="flex items-center gap-1 mt-4">
            {changeType === 'positive' ? (
              <TrendingUp className="w-4 h-4 text-green-400" />
            ) : (
              <TrendingDown className="w-4 h-4 text-red-400" />
            )}
            <span className={`text-sm font-semibold ${
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

  const navItems = [
    { icon: Home, label: 'Dashboard', href: '/dashboard', isActive: true },
    { icon: ReceiptText, label: 'Faturas', href: '/dashboard/invoices' },
    { icon: Brain, label: 'Análise', href: '/dashboard/analysis' },
    { icon: TrendingUp, label: 'Economia', href: '/dashboard/savings' },
    { icon: Cog, label: 'Configurações', href: '/dashboard/settings' }
  ];

  return (
    <div className="flex h-screen bg-gray-950">
      {/* Sidebar */}
      <div className={`fixed left-0 top-0 h-full w-64 bg-gradient-to-b from-gray-900/90 to-gray-950 backdrop-blur-md border-r border-white/10 transition-transform duration-300 z-40 ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        
        {/* Logo */}
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-white text-lg">Energy</span>
          </div>
          <p className="text-gray-400 text-xs mt-1">Gerenciamento Inteligente</p>
        </div>

        {/* Navigation */}
        <nav className="p-4 flex-1">
          {navItems.map((item) => (
            <Link key={item.label} href={item.href}>
              <div className={`flex items-center gap-3 px-4 py-3 rounded-lg mb-2 cursor-pointer transition-all duration-200 ${
                item.isActive
                  ? 'bg-gradient-to-r from-orange-500/30 to-red-600/20 border-l-2 border-orange-500 text-white'
                  : 'text-gray-400 hover:bg-white/5 hover:text-white'
              }`}>
                <item.icon className="w-5 h-5" />
                <span className="font-medium">{item.label}</span>
                {item.isActive && <ChevronRight className="w-4 h-4 ml-auto" />}
              </div>
            </Link>
          ))}
        </nav>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-white/10">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-red-400 hover:bg-red-500/10 transition-all duration-200"
          >
            <LogOut className="w-5 h-5" />
            <span className="font-medium">Sair</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className={`flex-1 flex flex-col ${sidebarOpen ? 'ml-64' : 'ml-0'} transition-all duration-300`}>
        
        {/* Top Bar */}
        <div className="sticky top-0 z-30 bg-gradient-to-b from-gray-900/80 to-gray-950/50 backdrop-blur-md border-b border-white/10">
          <div className="flex items-center justify-between px-8 py-4">
            
            {/* Left */}
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors text-gray-400 hover:text-white"
              >
                {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
              <h1 className="text-2xl font-bold text-white">Dashboard</h1>
            </div>

            {/* Right */}
            <div className="flex items-center gap-6">
              {/* Notifications */}
              <div className="relative">
                <button className="p-2 hover:bg-white/10 rounded-lg transition-colors relative">
                  <Bell className="w-5 h-5 text-gray-400 hover:text-white" />
                  {notificationCount > 0 && (
                    <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
                  )}
                </button>
              </div>

              {/* User Menu */}
              <div className="flex items-center gap-3 pl-6 border-l border-white/10">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center text-white font-bold">
                  {user?.email?.charAt(0).toUpperCase() || 'U'}
                </div>
                <div className="hidden sm:block">
                  <p className="text-sm font-semibold text-white">{user?.email?.split('@')[0] || 'Usuário'}</p>
                  <p className="text-xs text-gray-400">Cliente Premium</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Page Content */}
        <div className="flex-1 overflow-auto">
          <div className="p-8">
            
            {/* Welcome Section */}
            <div className="mb-8">
              <h2 className="text-3xl font-bold text-white mb-2">
                Bem-vindo de volta! 👋
              </h2>
              <p className="text-gray-400">Aqui está um resumo do seu consumo e economia.</p>
            </div>

            {/* KPI Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              <div className="h-40">
                <StatCard 
                  title="Economia Total"
                  value={`R$ ${kpis.totalSavings.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`}
                  unit=""
                  icon={TrendingUp}
                  change={kpis.savingsChange}
                  changeType="positive"
                />
              </div>
              
              <div className="h-40">
                <StatCard 
                  title="Total de Faturas"
                  value={kpis.totalInvoices}
                  unit="faturas"
                  icon={FileText}
                  changeType="neutral"
                />
              </div>
              
              <div className="h-40">
                <StatCard 
                  title="Consumo Médio"
                  value={kpis.avgConsumption}
                  unit="kWh"
                  icon={Zap}
                  change={kpis.consumptionChange}
                  changeType="positive"
                />
              </div>
              
              <div className="h-40">
                <StatCard 
                  title="Alertas Ativos"
                  value={kpis.alerts}
                  unit="itens"
                  icon={AlertCircle}
                  changeType="neutral"
                />
              </div>
            </div>

            {/* Secondary Metrics */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              {/* Cost This Month */}
              <div className="relative group">
                <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-white/5 rounded-xl backdrop-blur-md border border-white/10 group-hover:border-white/20 transition-all duration-300"></div>
                <div className="relative p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-gray-300 font-semibold">Custo Este Mês</h3>
                    <DollarSign className="w-5 h-5 text-blue-400" />
                  </div>
                  <div className="text-4xl font-bold text-white mb-2">
                    R$ {kpis.thisMonthCost.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                  </div>
                  <p className="text-gray-400 text-sm">Setembro de 2026</p>
                </div>
              </div>

              {/* Projected Savings */}
              <div className="relative group">
                <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-white/5 rounded-xl backdrop-blur-md border border-white/10 group-hover:border-white/20 transition-all duration-300"></div>
                <div className="relative p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-gray-300 font-semibold">Economia Projetada</h3>
                    <TrendingUp className="w-5 h-5 text-green-400" />
                  </div>
                  <div className="text-4xl font-bold text-white mb-2">
                    R$ {kpis.projectedSavings.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                  </div>
                  <p className="text-gray-400 text-sm">Próximos 30 dias</p>
                </div>
              </div>
            </div>

            {/* Recent Invoices */}
            <div className="relative group">
              <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-white/5 rounded-xl backdrop-blur-md border border-white/10 group-hover:border-white/20 transition-all duration-300"></div>
              <div className="relative p-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-semibold text-white">Faturas Recentes</h3>
                  <Link href="/dashboard/invoices" className="text-orange-400 hover:text-orange-300 text-sm font-medium flex items-center gap-1">
                    Ver tudo <ChevronRight className="w-4 h-4" />
                  </Link>
                </div>
                
                {invoices.length === 0 ? (
                  <p className="text-gray-400">Nenhuma fatura disponível</p>
                ) : (
                  <div className="space-y-3">
                    {invoices.map((invoice) => (
                      <div key={invoice.id} className="flex items-center justify-between py-3 px-4 bg-white/5 hover:bg-white/10 rounded-lg transition-colors border border-white/5">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500/30 to-blue-600/20 flex items-center justify-center">
                            <FileText className="w-5 h-5 text-blue-400" />
                          </div>
                          <div>
                            <p className="text-white font-medium">{invoice.month}</p>
                            <p className="text-gray-400 text-sm">{invoice.consumption} kWh</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-white font-semibold">R$ {invoice.amount.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
                          <span className="text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded-full">{invoice.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}
