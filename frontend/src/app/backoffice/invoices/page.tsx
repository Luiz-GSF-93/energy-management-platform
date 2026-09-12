'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api/client';
import { CreateInvoiceForm } from '@/components/forms/CreateInvoiceForm';
import { Invoice } from '@/types/invoice';
import { Eye, Download, Trash2, Plus } from 'lucide-react';

interface ConsumerUnit {
  id: string;
  organizationId: string;
  unitNumber: string;
  address: string;
  city: string;
}

interface Contract {
  id: string;
  consumerUnitId: string;
  contractNumber: string;
  status: string;
}

interface Analytics {
  totalInvoices: number;
  paidInvoices: number;
  issuedInvoices: number;
  totalAmount: number;
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [consumerUnits, setConsumerUnits] = useState<ConsumerUnit[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedUnitId, setSelectedUnitId] = useState<string>('');
  const [selectedContractId, setSelectedContractId] = useState<string>('');
  const [analytics, setAnalytics] = useState<Analytics>({
    totalInvoices: 0,
    paidInvoices: 0,
    issuedInvoices: 0,
    totalAmount: 0,
  });

  // Carregar dados ao montar o componente
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Carregar UCs, contratos e faturas
      const unitsRes = await api.consumerUnits.list();
      const contractsRes = await api.contracts.list();
      const invoicesRes = await api.invoices.list();

      // Garantir que são arrays
      const units = Array.isArray(unitsRes?.data) ? unitsRes.data : [];
      const contractsList = Array.isArray(contractsRes?.data) ? contractsRes.data : [];
      const invoicesList = Array.isArray(invoicesRes?.data) ? invoicesRes.data : [];

      setConsumerUnits(units);
      setContracts(contractsList);
      setInvoices(invoicesList);

      // Calcular análises
      const totalInvoices = invoicesList.length;
      const paidInvoices = invoicesList.filter((inv: Invoice) => inv.status === 'paid').length;
      const issuedInvoices = invoicesList.filter((inv: Invoice) => inv.status === 'issued').length;
      const totalAmount = invoicesList.reduce((sum: number, inv: Invoice) => sum + (inv.totalAmount || 0), 0);

      setAnalytics({
        totalInvoices,
        paidInvoices,
        issuedInvoices,
        totalAmount,
      });

      // Selecionar primeira UC e contrato se existirem
      if (units.length > 0) setSelectedUnitId(units[0].id);
      if (contractsList.length > 0) setSelectedContractId(contractsList[0].id);
    } catch (err: any) {
      const errorMsg = err.response?.data?.message || err.message || 'Erro ao carregar dados';
      setError(errorMsg);
      console.error('Erro ao carregar dados:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteInvoice = async (invoiceId: string) => {
    if (!confirm('Tem certeza que deseja deletar esta fatura?')) return;

    try {
      await api.invoices.delete(invoiceId);
      setInvoices(invoices.filter(inv => inv.id !== invoiceId));
      alert('Fatura deletada com sucesso!');
    } catch (err: any) {
      const errorMsg = err.response?.data?.message || 'Erro ao deletar fatura';
      alert(errorMsg);
    }
  };

  const handleInvoiceCreated = (newInvoice: Invoice) => {
    setInvoices([...invoices, newInvoice]);
    setShowCreateForm(false);
    loadData(); // Recarregar dados
    alert('Fatura criada com sucesso!');
  };

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'paid': return 'bg-green-600 text-white';
      case 'issued': return 'bg-blue-600 text-white';
      case 'draft': return 'bg-gray-600 text-white';
      case 'cancelled': return 'bg-red-600 text-white';
      default: return 'bg-slate-600 text-white';
    }
  };

  const formatDate = (date: Date | string | undefined) => {
    if (!date) return '--';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric' });
  };

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">📄 Gestão de Faturas</h1>
          <p className="text-slate-400">Registre e gerencie faturas de energia por Unidade Consumidora</p>
        </div>

        {/* Navigation */}
        <div className="flex gap-3 mb-8">
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg flex items-center gap-2 transition font-medium"
          >
            <Plus size={20} /> Nova Fatura
          </button>
          <a
            href="/backoffice/invoices/dashboard"
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition font-medium"
          >
            📊 Dashboard
          </a>
          <a
            href="/backoffice/invoices/audit"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-medium"
          >
            📋 Auditoria
          </a>
        </div>

        {/* Analytics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
            <p className="text-slate-400 text-sm mb-2">Total de Faturas</p>
            <p className="text-3xl font-bold text-white">{analytics.totalInvoices}</p>
          </div>
          <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
            <p className="text-slate-400 text-sm mb-2">Pagas</p>
            <p className="text-3xl font-bold text-green-400">{analytics.paidInvoices}</p>
          </div>
          <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
            <p className="text-slate-400 text-sm mb-2">Emitidas</p>
            <p className="text-3xl font-bold text-blue-400">{analytics.issuedInvoices}</p>
          </div>
          <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
            <p className="text-slate-400 text-sm mb-2">Valor Total</p>
            <p className="text-3xl font-bold text-yellow-400">
              R$ {analytics.totalAmount.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
            </p>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-900/50 border border-red-700 text-red-200 rounded-lg">
            {error}
          </div>
        )}

        {/* UC and Contract Selector */}
        {showCreateForm && (
          <div className="mb-6 grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Unidade Consumidora</label>
              <select
                value={selectedUnitId}
                onChange={(e) => setSelectedUnitId(e.target.value)}
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded text-white"
              >
                <option value="">Selecione uma UC</option>
                {consumerUnits.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.unitNumber} - {unit.address}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Contrato</label>
              <select
                value={selectedContractId}
                onChange={(e) => setSelectedContractId(e.target.value)}
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded text-white"
              >
                <option value="">Selecione um contrato</option>
                {contracts
                  .filter((c) => c.consumerUnitId === selectedUnitId)
                  .map((contract) => (
                    <option key={contract.id} value={contract.id}>
                      {contract.contractNumber}
                    </option>
                  ))}
              </select>
            </div>
          </div>
        )}

        {/* Create Invoice Form */}
        {showCreateForm && selectedUnitId && selectedContractId && (
          <div className="mb-8 bg-slate-800 p-6 rounded-lg border border-slate-700">
            <CreateInvoiceForm
              consumerUnitId={selectedUnitId}
              contractId={selectedContractId}
              onSuccess={handleInvoiceCreated}
              onError={(err) => {
                setError(err);
                console.error('Erro ao criar fatura:', err);
              }}
            />
          </div>
        )}

        {/* Invoices Table */}
        {loading ? (
          <div className="text-center py-12">
            <p className="text-slate-400">Carregando faturas...</p>
          </div>
        ) : invoices.length === 0 ? (
          <div className="bg-slate-800 p-8 rounded-lg text-center border border-slate-700">
            <p className="text-slate-400">Nenhuma fatura registrada ainda.</p>
            <button
              onClick={() => setShowCreateForm(true)}
              className="mt-4 px-6 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition font-medium"
            >
              Criar primeira fatura
            </button>
          </div>
        ) : (
          <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-700 border-b border-slate-600">
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
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.id} className="border-b border-slate-700 hover:bg-slate-700/50 transition">
                      <td className="px-6 py-4 text-sm text-white">{invoice.invoiceNumber}</td>
                      <td className="px-6 py-4 text-sm text-slate-300">
                        {formatDate(invoice.referenceMonth)}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-300">{invoice.consumerUnitNumber}</td>
                      <td className="px-6 py-4 text-sm text-slate-300">{(invoice.totalConsumptionKwh || 0).toLocaleString('pt-BR')}</td>
                      <td className="px-6 py-4 text-sm font-semibold text-white">
                        R$ {(invoice.totalAmount || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusBadgeColor(invoice.status)}`}>
                          {invoice.status === 'paid' ? '✓ Paga' : invoice.status === 'issued' ? '📤 Emitida' : invoice.status === 'draft' ? '📝 Rascunho' : '❌ Cancelada'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <div className="flex gap-2">
                          <button className="text-blue-400 hover:text-blue-300 transition" title="Visualizar">
                            <Eye size={18} />
                          </button>
                          <button className="text-green-400 hover:text-green-300 transition" title="Baixar PDF">
                            <Download size={18} />
                          </button>
                          <button
                            onClick={() => handleDeleteInvoice(invoice.id)}
                            className="text-red-400 hover:text-red-300 transition"
                            title="Deletar"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
