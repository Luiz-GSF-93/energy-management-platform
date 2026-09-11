"use client";

import { useState, useEffect } from 'react';
import { CheckCircle, Plus } from 'lucide-react';

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchApprovals = async () => {
      try {
        const token = localStorage.getItem('auth_token');
        const response = await fetch('https://energy-management-platform.onrender.com/api/v1/approvals', {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) throw new Error('Falha ao carregar aprovações');
        
        const data = await response.json();
        setApprovals(Array.isArray(data) ? data : data.data || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao carregar aprovações');
      } finally {
        setLoading(false);
      }
    };

    fetchApprovals();
  }, []);

  if (loading) {
    return (
      <div className="p-6 flex justify-center items-center h-full">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-400">Carregando aprovações...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-2">
            <CheckCircle className="w-8 h-8 text-purple-400" />
            Fluxo de Aprovações
          </h1>
          <p className="text-gray-400 mt-1">Total: {approvals.length} aprovações</p>
        </div>
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
                <th className="px-6 py-3 text-left font-semibold text-gray-300">Honorário</th>
                <th className="px-6 py-3 text-left font-semibold text-gray-300">Aprovador</th>
                <th className="px-6 py-3 text-left font-semibold text-gray-300">Email</th>
                <th className="px-6 py-3 text-left font-semibold text-gray-300">Status</th>
                <th className="px-6 py-3 text-left font-semibold text-gray-300">Comentários</th>
              </tr>
            </thead>
            <tbody>
              {approvals.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-400">
                    Nenhuma aprovação encontrada
                  </td>
                </tr>
              ) : (
                approvals.map((approval: any) => (
                  <tr key={approval.id} className="border-b border-gray-700 hover:bg-gray-800/50 transition">
                    <td className="px-6 py-3 text-white">{approval.feeId}</td>
                    <td className="px-6 py-3 text-gray-300">{approval.approverName}</td>
                    <td className="px-6 py-3 text-gray-300 text-xs">{approval.approverEmail}</td>
                    <td className="px-6 py-3">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                        approval.status === 'APPROVED'
                          ? 'bg-green-900/30 text-green-400'
                          : approval.status === 'REJECTED'
                          ? 'bg-red-900/30 text-red-400'
                          : 'bg-yellow-900/30 text-yellow-400'
                      }`}>
                        {approval.status || 'Pendente'}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-gray-400 text-xs">{approval.comments || '-'}</td>
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
