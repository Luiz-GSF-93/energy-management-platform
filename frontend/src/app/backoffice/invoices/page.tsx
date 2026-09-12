'use client';

import { useState, useEffect } from 'react';
import { Download, Eye, Trash2, Plus } from 'lucide-react';
import Link from 'next/link';

interface Invoice {
  id: string;
  invoiceNumber: string;
  referenceMonth: string;
  consumerUnitNumber: string;
  totalConsumptionKwh: number;
  totalAmount: number;
  status: string;
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    setLoading(false);
    setInvoices([
      {
        id: '1',
        invoiceNumber: 'INV-202606-0001',
        referenceMonth: '2026-06-01',
        consumerUnitNumber: '4001234567891',
        totalConsumptionKwh: 1200,
        totalAmount: 2150.50,
        status: 'paid',
      },
      {
        id: '2',
        invoiceNumber: 'INV-202607-0002',
        referenceMonth: '2026-07-01',
        consumerUnitNumber: '4001234567891',
        totalConsumptionKwh: 1350,
        totalAmount: 2380.75,
        status: 'issued',
      },
    ]);
  }, []);

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      draft: 'bg-slate-900/50 text-slate-300 border border-slate-600',
      issued: 'bg-blue-900/50 text-blue-300 border border-blue-700',
      paid: 'bg-green-900/50 text-green-300 border border-green-700',
      cancelled: 'bg-red-900/50 text-red-300 border border-red-700',
    };
    return styles[status] || styles.draft;
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white">📋 Gestão de Faturas</h1>
          <p className="text-slate-400 mt-1">Registre e gerencie faturas de energia</p>
        </div>
        <div className="flex gap-3">
          <Link href="/backoffice/invoices/dashboard" className="bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700 font-medium transition">
            📊 Dashboard
          </Link>
          <Link href="/backoffice/invoices/audit" className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 font-medium transition">
            🔍 Auditoria
          </Link>
          <button onClick={() => setShowForm(!showForm)} className="bg-orange-600 text-white px-6 py-2 rounded-lg hover:bg-orange-700 font-medium transition flex items-center gap-2">
            <Plus size={20} /> Nova Fatura
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 shadow-lg">
          <h2 className="text-xl font-bold text-white mb-4">📝 Criar Nova Fatura</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Nº Fatura</label>
                <input type="text" placeholder="INV-202606-0001" className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Mês/Ano</label>
                <input type="date" className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white" />
              </div>
            </div>
            <div className="flex gap-4">
              <button onClick={() => setShowForm(false)} className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition">
                Cancelar
              </button>
              <button className="flex-1 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition">
                Criar Fatura
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Analytics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-800 p-4 rounded-lg shadow-lg border border-slate-700">
          <p className="text-slate-400 text-sm">Total Faturas</p>
          <p className="text-3xl font-bold text-white mt-2">{invoices.length}</p>
        </div>
        <div className="bg-green-900/30 p-4 rounded-lg shadow-lg border border-green-800">
          <p className="text-green-300 text-sm">Pagas</p>
          <p className="text-3xl font-bold text-green-400 mt-2">{invoices.filter(i => i.status === 'paid').length}</p>
        </div>
        <div className="bg-blue-900/30 p-4 rounded-lg shadow-lg border border-blue-800">
          <p className="text-blue-300 text-sm">Emitidas</p>
          <p className="text-3xl font-bold text-blue-400 mt-2">{invoices.filter(i => i.status === 'issued').length}</p>
        </div>
        <div className="bg-yellow-900/30 p-4 rounded-lg shadow-lg border border-yellow-800">
          <p className="text-yellow-300 text-sm">Valor Total</p>
          <p className="text-3xl font-bold text-yellow-400 mt-2">
            R$ {invoices.reduce((sum, i) => sum + i.totalAmount, 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      {/* Tabela de Faturas */}
      {loading ? (
        <div className="text-center py-12 bg-slate-800 rounded-lg border border-slate-700">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600 mx-auto"></div>
          <p className="text-slate-400 mt-4">Carregando faturas...</p>
        </div>
      ) : (
        <div className="bg-slate-800 rounded-lg shadow-lg overflow-hidden border border-slate-700">
          <table className="w-full">
            <thead className="bg-slate-900 border-b border-slate-700">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Nº Fatura</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Mês/Ano</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">UC</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Consumo (kWh)</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Valor Total</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Status</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {invoices.map((invoice) => (
                <tr key={invoice.id} className="hover:bg-slate-700 transition">
                  <td className="px-6 py-4 text-sm font-semibold text-white">{invoice.invoiceNumber}</td>
                  <td className="px-6 py-4 text-sm text-slate-300">
                    {new Date(invoice.referenceMonth).toLocaleDateString('pt-BR', { year: 'numeric', month: '2-digit' })}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-300">{invoice.consumerUnitNumber}</td>
                  <td className="px-6 py-4 text-sm text-slate-300">{invoice.totalConsumptionKwh.toLocaleString('pt-BR')}</td>
                  <td className="px-6 py-4 text-sm font-semibold text-white">
                    R$ {invoice.totalAmount.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusBadge(invoice.status)}`}>
                      {invoice.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm flex gap-2">
                    <button className="text-blue-400 hover:text-blue-300 transition" title="Visualizar">
                      <Eye size={16} />
                    </button>
                    <button className="text-orange-400 hover:text-orange-300 transition" title="Download">
                      <Download size={16} />
                    </button>
                    <button className="text-red-400 hover:text-red-300 transition" title="Deletar">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
