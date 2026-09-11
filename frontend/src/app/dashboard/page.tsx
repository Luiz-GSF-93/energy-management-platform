'use client';

import { useState, useEffect } from 'react';
import { LogOut, TrendingUp, FileText, AlertCircle, DollarSign, Zap } from 'lucide-react';

export default function DashboardHome() {
  const [user, setUser] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Carregar dados do usuário e faturas
    const token = localStorage.getItem('authToken');
    if (!token) {
      window.location.href = '/auth/login';
      return;
    }

    // Simular dados do usuário
    setUser({
      email: localStorage.getItem('userEmail') || 'teste@expertenergy.com.br',
      name: 'Usuário Teste'
    });

    // Buscar faturas da API
    fetch('https://energy-management-platform.onrender.com/api/v1/invoices', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(data => {
        console.log('Invoices:', data);
        setInvoices(data.data || []);
      })
      .catch(err => console.error('Erro ao carregar faturas:', err))
      .finally(() => setIsLoading(false));
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('authToken');
    window.location.href = '/auth/login';
  };

  const totalSavings = invoices.reduce((acc, inv) => acc + (inv.savings || 0), 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="bg-black/40 backdrop-blur border-b border-white/10 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-white">⚡ Energy Management</h1>
            <p className="text-sm text-gray-400">{user?.email}</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center space-x-2 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-500/50 rounded-lg text-red-400 transition"
          >
            <LogOut size={18} />
            <span>Sair</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {/* Card: Total Economizado */}
          <div className="bg-gradient-to-br from-green-600/20 to-green-900/20 border border-green-500/30 rounded-lg p-6 backdrop-blur">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-gray-300">Economia Total</h3>
              <TrendingUp className="w-5 h-5 text-green-400" />
            </div>
            <p className="text-3xl font-bold text-green-400">R$ {totalSavings.toFixed(2)}</p>
            <p className="text-xs text-gray-400 mt-2">+12% vs mês anterior</p>
          </div>

          {/* Card: Total de Faturas */}
          <div className="bg-gradient-to-br from-blue-600/20 to-blue-900/20 border border-blue-500/30 rounded-lg p-6 backdrop-blur">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-gray-300">Total de Faturas</h3>
              <FileText className="w-5 h-5 text-blue-400" />
            </div>
            <p className="text-3xl font-bold text-blue-400">{invoices.length}</p>
            <p className="text-xs text-gray-400 mt-2">Todas as faturas carregadas</p>
          </div>

          {/* Card: Consumo Médio */}
          <div className="bg-gradient-to-br from-yellow-600/20 to-yellow-900/20 border border-yellow-500/30 rounded-lg p-6 backdrop-blur">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-gray-300">Consumo Médio</h3>
              <Zap className="w-5 h-5 text-yellow-400" />
            </div>
            <p className="text-3xl font-bold text-yellow-400">1.250 kWh</p>
            <p className="text-xs text-gray-400 mt-2">Por mês</p>
          </div>

          {/* Card: Alertas */}
          <div className="bg-gradient-to-br from-red-600/20 to-red-900/20 border border-red-500/30 rounded-lg p-6 backdrop-blur">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-gray-300">Alertas</h3>
              <AlertCircle className="w-5 h-5 text-red-400" />
            </div>
            <p className="text-3xl font-bold text-red-400">2</p>
            <p className="text-xs text-gray-400 mt-2">Requerem atenção</p>
          </div>
        </div>

        {/* Faturas Recentes */}
        <div className="bg-white/5 border border-white/10 rounded-lg backdrop-blur p-6">
          <h2 className="text-xl font-bold text-white mb-6">Faturas Recentes</h2>
          {isLoading ? (
            <p className="text-gray-400">Carregando...</p>
          ) : invoices.length === 0 ? (
            <p className="text-gray-400">Nenhuma fatura disponível</p>
          ) : (
            <div className="space-y-4">
              {invoices.slice(0, 5).map((invoice: any) => (
                <div key={invoice.id} className="flex items-center justify-between p-4 bg-white/5 rounded-lg border border-white/10 hover:bg-white/10 transition">
                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 bg-blue-600/30 rounded-lg flex items-center justify-center">
                      <FileText className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                      <p className="font-medium text-white">{invoice.invoiceNumber}</p>
                      <p className="text-sm text-gray-400">{invoice.referenceMonth}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-white">R$ {invoice.totalAmount?.toFixed(2) || '0.00'}</p>
                    <p className="text-xs text-green-400">{invoice.status}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
