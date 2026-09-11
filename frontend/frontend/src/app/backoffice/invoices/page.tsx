'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api/client';
import { Invoice, InvoiceAnalytics } from '@/types/invoice';
import { CreateInvoiceForm } from '@/components/forms/CreateInvoiceForm';
import { Download, Eye, Trash2 } from 'lucide-react';

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [analytics, setAnalytics] = useState<InvoiceAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [selectedConsumerUnit, setSelectedConsumerUnit] = useState<string>('');
  const [selectedContract, setSelectedContract] = useState<string>('');
  const [consumerUnits, setConsumerUnits] = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Carregar UCs e contratos para o formulário
      const unitsRes = await api.consumerUnits.list();
      if (unitsRes.data) {
        setConsumerUnits(Array.isArray(unitsRes.data) ? unitsRes.data : []);
      }

      const contractsRes = await api.contracts.list();
      if (contractsRes.data) {
        setContracts(Array.isArray(contractsRes.data) ? contractsRes.data : []);
      }

      // Carregar faturas
      const invoicesRes = await api.invoices.list();
      if (invoicesRes.data) {
        setInvoices(Array.isArray(invoicesRes.data) ? invoicesRes.data : []);
      }

      // Calcular analytics
      if (invoicesRes.data && Array.isArray(invoicesRes.data)) {
        const invList = invoicesRes.data as Invoice[];
        const total = invList.length;
        const paid = invList.filter((inv) => inv.status === 'paid').length;
        const pending = invList.filter((inv) => inv.status === 'issued').length;
        const totalAmount = invList.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);
        const avgSavings = invList.reduce((sum, inv) => sum + ((inv.regulatedComparison || 0) - (inv.totalAmount || 0)), 0) / Math.max(total, 1);

        setAnalytics({
          total,
          issued: pending,
          paid,
          pending,
          totalAmount,
          averageSavings: avgSavings,
          savingsPercentage: (avgSavings / (totalAmount / Math.max(total, 1))) * 100,
        });
      }
    } catch (err: any) {
      console.error('Erro ao carregar dados:', err);
      setError(err.message || 'Erro ao carregar faturas');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSuccess = (newInvoice: Invoice) => {
    console.log('Fatura criada:', newInvoice);
    setInvoices([newInvoice, ...invoices]);
    setShowForm(false);
    loadData();
  };

  const handleCreateError = (errorMsg: string) => {
    console.error('Erro ao criar fatura:', errorMsg);
    setError(errorMsg);
  };

  const handleDelete = async (invoiceId: string) => {
    if (!confirm('Tem certeza que deseja deletar esta fatura?')) return;

    try {
      await api.invoices.delete(invoiceId);
      setInvoices(invoices.filter((inv) => inv.id !== invoiceId));
      alert('Fatura deletada com sucesso');
    } catch (err: any) {
      alert(`Erro ao deletar: ${err.message}`);
    }
  };

  const getStatusBadge = (status: string) => {
    const badgeStyles: Record<string, string> = {
      draft: 'bg-slate-900/50 text-slate-300 border border-slate-700',
      issued: 'bg-blue-900/50 text-blue-300 border border-blue-700',
      paid: 'bg-green-900/50 text-green-300 border border-green-700',
      cancelled: 'bg-red-900/50 text-red-300 border border-red-700',
    };
    return badgeStyles[status] || badgeStyles.draft;
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white">📋 Gestão de Faturas</h1>
          <p className="text-slate-400 mt-1">Registre e gerencie faturas de energia de suas UCs</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-orange-600 text-white px-6 py-2 rounded-lg hover:bg-orange-700 font-medium transition shadow-lg"
        >
          {showForm ? '✕ Cancelar' : '+ Nova Fatura'}
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-900/50 border border-red-700 text-red-200 rounded-lg">
          ⚠️ {error}
        </div>
      )}

      {/* Analytics Cards */}
      {analytics && !loading && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="bg-slate-800 p-4 rounded-lg shadow-lg border border-slate-700">
            <p className="text-slate-400 text-sm">Total Faturas</p>
            <p className="text-3xl font-bold text-white mt-2">{analytics.total}</p>
          </div>
          <div className="bg-blue-900/30 p-4 rounded-lg shadow-lg border border-blue-800">
            <p className="text-blue-300 text-sm">Emitidas</p>
            <p className="text-3xl font-bold text-blue-400 mt-2">{analytics.issued}</p>
          </div>
          <div className="bg-green-900/30 p-4 rounded-lg shadow-lg border border-green-800">
            <p className="text-green-300 text-sm">Pagas</p>
            <p className="text-3xl font-bold text-green-400 mt-2">{analytics.paid}</p>
          </div>
          <div className="bg-yellow-900/30 p-4 rounded-lg shadow-lg border border-yellow-800">
            <p className="text-yellow-300 text-sm">Valor Total</p>
            <p className="text-3xl font-bold text-yellow-400 mt-2">
              R$ {analytics.totalAmount.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
            </p>
          </div>
          <div className="bg-emerald-900/30 p-4 rounded-lg shadow-lg border border-emerald-800">
            <p className="text-emerald-300 text-sm">Economia Média</p>
            <p className="text-3xl font-bold text-emerald-400 mt-2">
              {analytics.savingsPercentage.toFixed(1)}%
            </p>
          </div>
        </div>
      )}

      {/* Formulário */}
      {showForm && consumerUnits.length > 0 && contracts.length > 0 && (
        <CreateInvoiceForm
          consumerUnitId={selectedConsumerUnit || consumerUnits[0]?.id || ''}
          contractId={selectedContract || contracts[0]?.id || ''}
          onSuccess={handleCreateSuccess}
          onError={handleCreateError}
        />
      )}

      {showForm && (consumerUnits.length === 0 || contracts.length === 0) && (
        <div className="bg-yellow-900/30 p-4 border border-yellow-800 text-yellow-300 rounded-lg">
          ⚠️ Você precisa criar UCs e Contratos antes de registrar faturas.
        </div>
      )}

      {/* Tabela de Faturas */}
      {loading ? (
        <div className="text-center py-12 bg-slate-800 rounded-lg shadow-lg border border-slate-700">
          <div className="inline-block">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600"></div>
          </div>
          <p className="text-slate-400 mt-4">Carregando faturas...</p>
        </div>
      ) : invoices.length === 0 ? (
        <div className="bg-slate-800 p-12 rounded-lg shadow-lg text-center border border-slate-700">
          <p className="text-slate-400">Nenhuma fatura registrada</p>
          <button
            onClick={() => setShowForm(true)}
            className="mt-4 text-orange-500 hover:text-orange-400 font-medium transition"
          >
            Registrar primeira fatura
          </button>
        </div>
      ) : (
        <div className="bg-slate-800 rounded-lg shadow-lg overflow-x-auto border border-slate-700">
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
                  <td className="px-6 py-4 text-sm text-slate-300">
                    {invoice.totalConsumptionKwh.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-6 py-4 text-sm font-semibold text-white">
                    R$ {invoice.totalAmount.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusBadge(invoice.status)}`}>
                      {invoice.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm flex gap-2">
                    <button className="text-blue-400 hover:text-blue-300" title="Visualizar">
                      <Eye size={16} />
                    </button>
                    <button className="text-orange-400 hover:text-orange-300" title="Download PDF">
                      <Download size={16} />
                    </button>
                    <button onClick={() => handleDelete(invoice.id)} className="text-red-400 hover:text-red-300" title="Deletar">
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
