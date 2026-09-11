'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api/client';
import { Contract, ContractAnalytics } from '@/types/api';
import { CreateContractForm } from '@/components/forms/CreateContractForm';

export default function ContratosPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [analytics, setAnalytics] = useState<ContractAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      console.log('Carregando contratos...');
      const contractsRes = await api.contracts.list();
      if (contractsRes.data) {
        setContracts(Array.isArray(contractsRes.data) ? contractsRes.data : []);
      }

      const analyticsRes = await api.contracts.analytics();
      if (analyticsRes.data) {
        setAnalytics(analyticsRes.data as ContractAnalytics);
      }
    } catch (err: any) {
      console.error('Erro ao carregar dados:', err);
      setError(err.message || 'Erro ao carregar contratos');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSuccess = (newContract: Contract) => {
    console.log('Contrato criado:', newContract);
    setContracts([newContract, ...contracts]);
    setShowForm(false);
    loadData();
  };

  const handleCreateError = (errorMsg: string) => {
    console.error('Erro ao criar contrato:', errorMsg);
    setError(errorMsg);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white">Gestão de Contratos</h1>
          <p className="text-slate-400 mt-1">Gerencie todos os contratos da plataforma</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-orange-600 text-white px-6 py-2 rounded-lg hover:bg-orange-700 font-medium transition shadow-lg"
        >
          {showForm ? '✕ Cancelar' : '+ Novo Contrato'}
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
            <p className="text-slate-400 text-sm">Total</p>
            <p className="text-3xl font-bold text-white mt-2">{analytics.total}</p>
          </div>
          <div className="bg-green-900/30 p-4 rounded-lg shadow-lg border border-green-800">
            <p className="text-green-300 text-sm">Ativos</p>
            <p className="text-3xl font-bold text-green-400 mt-2">{analytics.active}</p>
          </div>
          <div className="bg-slate-700 p-4 rounded-lg shadow-lg border border-slate-600">
            <p className="text-slate-400 text-sm">Inativos</p>
            <p className="text-3xl font-bold text-slate-200 mt-2">{analytics.inactive}</p>
          </div>
          <div className="bg-yellow-900/30 p-4 rounded-lg shadow-lg border border-yellow-800">
            <p className="text-yellow-300 text-sm">Suspensos</p>
            <p className="text-3xl font-bold text-yellow-400 mt-2">{analytics.suspended}</p>
          </div>
          <div className="bg-blue-900/30 p-4 rounded-lg shadow-lg border border-blue-800">
            <p className="text-blue-300 text-sm">Valor Total</p>
            <p className="text-3xl font-bold text-blue-400 mt-2">
              R$ {analytics.totalValue.toLocaleString('pt-BR')}
            </p>
          </div>
        </div>
      )}

      {/* Formulário */}
      {showForm && (
        <CreateContractForm 
          onSuccess={handleCreateSuccess}
          onError={handleCreateError}
        />
      )}

      {/* Tabela de Contratos */}
      {loading ? (
        <div className="text-center py-12 bg-slate-800 rounded-lg shadow-lg border border-slate-700">
          <div className="inline-block">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600"></div>
          </div>
          <p className="text-slate-400 mt-4">Carregando contratos...</p>
        </div>
      ) : contracts.length === 0 ? (
        <div className="bg-slate-800 p-12 rounded-lg shadow-lg text-center border border-slate-700">
          <p className="text-slate-400">Nenhum contrato encontrado</p>
          <button
            onClick={() => setShowForm(true)}
            className="mt-4 text-orange-500 hover:text-orange-400 font-medium transition"
          >
            Criar primeiro contrato
          </button>
        </div>
      ) : (
        <div className="bg-slate-800 rounded-lg shadow-lg overflow-hidden border border-slate-700">
          <table className="w-full">
            <thead className="bg-slate-900 border-b border-slate-700">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Número</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Título</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Taxa Mensal</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Comissão</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Tipo</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {contracts.map((contract) => (
                <tr key={contract.id} className="hover:bg-slate-700 transition">
                  <td className="px-6 py-4 text-sm font-semibold text-white">{contract.contractNumber}</td>
                  <td className="px-6 py-4 text-sm text-slate-300">{contract.contractTitle}</td>
                  <td className="px-6 py-4 text-sm text-slate-300">
                    R$ {contract.monthlyFee.toLocaleString('pt-BR')}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-300">{contract.commissionPercentage}%</td>
                  <td className="px-6 py-4 text-sm">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      contract.contractType === 'STANDARD'
                        ? 'bg-blue-900/50 text-blue-300 border border-blue-700'
                        : 'bg-purple-900/50 text-purple-300 border border-purple-700'
                    }`}>
                      {contract.contractType}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      contract.status === 'ACTIVE'
                        ? 'bg-green-900/50 text-green-300 border border-green-700'
                        : contract.status === 'INACTIVE'
                          ? 'bg-slate-700 text-slate-300 border border-slate-600'
                          : 'bg-yellow-900/50 text-yellow-300 border border-yellow-700'
                    }`}>
                      {contract.status}
                    </span>
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
