"use client";

import { useState, useEffect } from 'react';
import { DollarSign, Plus } from 'lucide-react';

export default function FeesPage() {
  const [fees, setFees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchFees = async () => {
      try {
        const token = localStorage.getItem('auth_token');
        const response = await fetch('https://energy-management-platform.onrender.com/api/v1/fees', {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) throw new Error('Falha ao carregar honorários');
        
        const data = await response.json();
        setFees(Array.isArray(data) ? data : data.data || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao carregar honorários');
      } finally {
        setLoading(false);
      }
    };

    fetchFees();
  }, []);

  if (loading) {
    return (
      <div className="p-6 flex justify-center items-center h-full">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-400">Carregando honorários...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-2">
            <DollarSign className="w-8 h-8 text-green-400" />
            Gestão de Honorários
          </h1>
          <p className="text-gray-400 mt-1">Total: {fees.length} honorários</p>
        </div>
        <button className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition">
          <Plus className="w-5 h-5" />
          Novo Honorário
        </button>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-700 rounded-lg p-4 text-red-400">
          {error}
        </div>
      )}

      <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-800 border-b border-gray-700">
              <tr>
                <th className="px-6 py-3 text-left font-semibold text-gray-300">Contrato</th>
                <th className="px-6 py-3 text-left font-semibold text-gray-300">Mês</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-300">Honorário Base</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-300">Comissão</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-300">Total</th>
                <th className="px-6 py-3 text-left font-semibold text-gray-300">Status</th>
              </tr>
            </thead>
            <tbody>
              {fees.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-gray-400">
                    Nenhum honorário encontrado
                  </td>
                </tr>
              ) : (
                fees.map((fee: any) => (
                  <tr key={fee.id} className="border-b border-gray-700 hover:bg-gray-800/50 transition">
                    <td className="px-6 py-3 text-white">{fee.contractId}</td>
                    <td className="px-6 py-3 text-gray-300">{fee.referenceMonth}</td>
                    <td className="px-6 py-3 text-right text-gray-300">R$ {fee.baseFee?.toFixed(2) || '0.00'}</td>
                    <td className="px-6 py-3 text-right text-blue-400">R$ {fee.commission?.toFixed(2) || '0.00'}</td>
                    <td className="px-6 py-3 text-right text-green-400 font-semibold">R$ {fee.totalFee?.toFixed(2) || '0.00'}</td>
                    <td className="px-6 py-3">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                        fee.status === 'PAID' 
                          ? 'bg-green-900/30 text-green-400'
                          : fee.status === 'PENDING'
                          ? 'bg-yellow-900/30 text-yellow-400'
                          : 'bg-red-900/30 text-red-400'
                      }`}>
                        {fee.status || 'Pendente'}
                      </span>
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
