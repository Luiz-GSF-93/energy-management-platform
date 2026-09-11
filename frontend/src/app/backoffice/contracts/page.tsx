'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api/client';
import { Contract, ContractAnalytics } from '@/types/api';
import { CreateContractForm } from '@/components/forms/CreateContractForm';

export default function ContratosPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [analytics, setAnalytics] = useState<ContractAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [contractsRes, analyticsRes] = await Promise.all([
        api.contracts.list(),
        api.contracts.analytics(),
      ]);

      if (contractsRes.data) {
        setContracts(Array.isArray(contractsRes.data) ? contractsRes.data : []);
      }
      if (analyticsRes.data) {
        setAnalytics(analyticsRes.data as ContractAnalytics);
      }
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSuccess = (newContract: Contract) => {
    setContracts([newContract, ...contracts]);
    setShowForm(false);
    loadData(); // Recarregar analytics
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-800">Contratos</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 font-medium transition"
        >
          {showForm ? 'Cancelar' : '+ Novo Contrato'}
        </button>
      </div>

      {/* Analytics Cards */}
      {analytics && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="bg-white p-4 rounded-lg shadow">
            <p className="text-gray-500 text-sm">Total</p>
            <p className="text-2xl font-bold text-gray-800">{analytics.total}</p>
          </div>
          <div className="bg-green-50 p-4 rounded-lg shadow border-l-4 border-green-500">
            <p className="text-gray-500 text-sm">Ativos</p>
            <p className="text-2xl font-bold text-green-600">{analytics.active}</p>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg shadow border-l-4 border-gray-500">
            <p className="text-gray-500 text-sm">Inativos</p>
            <p className="text-2xl font-bold text-gray-600">{analytics.inactive}</p>
          </div>
          <div className="bg-yellow-50 p-4 rounded-lg shadow border-l-4 border-yellow-500">
            <p className="text-gray-500 text-sm">Suspensos</p>
            <p className="text-2xl font-bold text-yellow-600">{analytics.suspended}</p>
          </div>
          <div className="bg-blue-50 p-4 rounded-lg shadow border-l-4 border-blue-500">
            <p className="text-gray-500 text-sm">Valor Total</p>
            <p className="text-2xl font-bold text-blue-600">R$ {analytics.totalValue.toLocaleString('pt-BR')}</p>
          </div>
        </div>
      )}

      {/* Formulário */}
      {showForm && (
        <CreateContractForm onSuccess={handleCreateSuccess} />
      )}

      {/* Tabela de Contratos */}
      {loading ? (
        <div className="text-center py-12">
          <p className="text-gray-500">Carregando contratos...</p>
        </div>
      ) : contracts.length === 0 ? (
        <div className="bg-white p-12 rounded-lg shadow text-center">
          <p className="text-gray-500">Nenhum contrato encontrado</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">Número</th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">Título</th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">Taxa Mensal</th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">Comissão</th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">Tipo</th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">Status</th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {contracts.map((contract) => (
                <tr key={contract.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{contract.contractNumber}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{contract.contractTitle}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">R$ {contract.monthlyFee.toLocaleString('pt-BR')}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{contract.commissionPercentage}%</td>
                  <td className="px-6 py-4 text-sm">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      contract.contractType === 'STANDARD'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-purple-100 text-purple-800'
                    }`}>
                      {contract.contractType}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      contract.status === 'ACTIVE'
                        ? 'bg-green-100 text-green-800'
                        : contract.status === 'INACTIVE'
                          ? 'bg-gray-100 text-gray-800'
                          : 'bg-yellow-100 text-yellow-800'
                    }`}>
                      {contract.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <button className="text-blue-600 hover:text-blue-800 font-medium mr-4">
                      Editar
                    </button>
                    <button className="text-red-600 hover:text-red-800 font-medium">
                      Deletar
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
