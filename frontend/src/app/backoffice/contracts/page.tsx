"use client";

import { useState, useEffect } from 'react';
import { FileText, Plus, Eye, Trash2, Edit } from 'lucide-react';

export default function ContractsPage() {
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchContracts = async () => {
      try {
        const token = localStorage.getItem('auth_token');
        const response = await fetch('https://energy-management-platform.onrender.com/api/v1/contracts', {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) throw new Error('Falha ao carregar contratos');
        
        const data = await response.json();
        setContracts(Array.isArray(data) ? data : data.data || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao carregar contratos');
      } finally {
        setLoading(false);
      }
    };

    fetchContracts();
  }, []);

  if (loading) {
    return (
      <div className="p-6 flex justify-center items-center h-full">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-400">Carregando contratos...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-2">
            <FileText className="w-8 h-8 text-blue-400" />
            Gestão de Contratos
          </h1>
          <p className="text-gray-400 mt-1">Total: {contracts.length} contratos</p>
        </div>
        <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition">
          <Plus className="w-5 h-5" />
          Novo Contrato
        </button>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-700 rounded-lg p-4 text-red-400 flex items-center gap-2">
          <span>❌</span>
          <span>{error}</span>
        </div>
      )}

      {/* Table */}
      <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-800 border-b border-gray-700">
              <tr>
                <th className="px-6 py-3 text-left font-semibold text-gray-300">Contrato</th>
                <th className="px-6 py-3 text-left font-semibold text-gray-300">Cliente</th>
                <th className="px-6 py-3 text-left font-semibold text-gray-300">Valor Mensal</th>
                <th className="px-6 py-3 text-left font-semibold text-gray-300">Comissão</th>
                <th className="px-6 py-3 text-left font-semibold text-gray-300">Status</th>
                <th className="px-6 py-3 text-center font-semibold text-gray-300">Ações</th>
              </tr>
            </thead>
            <tbody>
              {contracts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-gray-400">
                    Nenhum contrato encontrado
                  </td>
                </tr>
              ) : (
                contracts.map((contract: any) => (
                  <tr key={contract.id} className="border-b border-gray-700 hover:bg-gray-800/50 transition">
                    <td className="px-6 py-3 text-white font-medium">{contract.contractNumber}</td>
                    <td className="px-6 py-3 text-gray-300">{contract.customerId || 'N/A'}</td>
                    <td className="px-6 py-3 text-green-400 font-semibold">
                      R$ {contract.monthlyFee?.toFixed(2) || '0.00'}
                    </td>
                    <td className="px-6 py-3 text-blue-400">{contract.commissionPercentage}%</td>
                    <td className="px-6 py-3">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                        contract.status === 'ACTIVE' 
                          ? 'bg-green-900/30 text-green-400' 
                          : 'bg-gray-700 text-gray-300'
                      }`}>
                        {contract.status || 'Ativo'}
                      </span>
                    </td>
                    <td className="px-6 py-3 flex justify-center gap-2">
                      <button className="p-2 hover:bg-gray-700 rounded transition text-blue-400">
                        <Eye className="w-4 h-4" />
                      </button>
                      <button className="p-2 hover:bg-gray-700 rounded transition text-yellow-400">
                        <Edit className="w-4 h-4" />
                      </button>
                      <button className="p-2 hover:bg-gray-700 rounded transition text-red-400">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
