'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api/client';
import CreateInvoiceForm from '@/components/forms/CreateInvoiceForm';
import InvoicesNavigation from '@/components/InvoicesNavigation';
import { FileText, Trash2, Calendar } from 'lucide-react';

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadInvoices();
  }, []);

  const loadInvoices = async () => {
    try {
      setLoading(true);
      const data = await api.invoices.list();
      setInvoices(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Erro ao carregar faturas:', err);
      setError('Erro ao carregar faturas');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Deletar esta fatura?')) return;
    try {
      await api.invoices.delete(id);
      setInvoices(invoices.filter((inv) => inv.id !== id));
    } catch (err) {
      console.error('Erro:', err);
      setError('Erro ao deletar');
    }
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);

  const formatDate = (date: string | Date) =>
    new Intl.DateTimeFormat('pt-BR', { year: 'numeric', month: '2-digit' }).format(new Date(date));

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-3">
            <FileText size={32} className="text-blue-400" />
            Gestão de Faturas
          </h1>
          <p className="text-slate-400">Crie, visualize e gerencie suas faturas</p>
        </div>

        <InvoicesNavigation />

        <div className="mb-8">
          <CreateInvoiceForm />
        </div>

        <div className="bg-slate-800 rounded-lg border border-slate-700 p-6">
          <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
            <Calendar size={24} />
            Faturas Recentes
          </h2>

          {error && (
            <div className="mb-6 p-4 bg-red-900/30 border border-red-500/50 rounded-lg text-red-200">
              {error}
            </div>
          )}

          {loading ? (
            <p className="text-slate-400 text-center py-12">Carregando...</p>
          ) : invoices.length === 0 ? (
            <p className="text-slate-400 text-center py-12">Nenhuma fatura</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-600">
                    <th className="text-left py-3 px-4 text-slate-300">Período</th>
                    <th className="text-left py-3 px-4 text-slate-300">UC</th>
                    <th className="text-left py-3 px-4 text-slate-300">Status</th>
                    <th className="text-right py-3 px-4 text-slate-300">Regulado</th>
                    <th className="text-right py-3 px-4 text-slate-300">ACL</th>
                    <th className="text-right py-3 px-4 text-slate-300">Economia</th>
                    <th className="text-center py-3 px-4 text-slate-300">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice: any) => (
                    <tr key={invoice.id} className="border-b border-slate-700 hover:bg-slate-700/30">
                      <td className="py-3 px-4 text-white">{formatDate(invoice.referenceMonth)}</td>
                      <td className="py-3 px-4 text-white">{invoice.consumerUnitId}</td>
                      <td className="py-3 px-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                          invoice.status === 'PAGA' ? 'bg-green-900/30 text-green-400' :
                          invoice.status === 'EMITIDA' ? 'bg-blue-900/30 text-blue-400' :
                          'bg-yellow-900/30 text-yellow-400'
                        }`}>
                          {invoice.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-slate-300">{formatCurrency(invoice.regulatedCost)}</td>
                      <td className="py-3 px-4 text-right text-slate-300">{formatCurrency(invoice.aclCost)}</td>
                      <td className="py-3 px-4 text-right text-green-400 font-semibold">{formatCurrency(invoice.savings)}</td>
                      <td className="py-3 px-4 text-center">
                        <button onClick={() => handleDelete(invoice.id)} className="p-2 hover:bg-red-900/30 rounded text-red-400">
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
