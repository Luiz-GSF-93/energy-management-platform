'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api/client';
import CreateContractForm from '@/components/forms/CreateContractForm';
import { FileText } from 'lucide-react';

export default function ContractsPage() {
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [analytics, setAnalytics] = useState<any>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const contractsData = await api.contracts.list();
      setContracts(Array.isArray(contractsData) ? contractsData : []);
      
      try {
        const analyticsData = await api.contracts.analytics();
        setAnalytics(analyticsData as any);
      } catch (err) {
        console.warn('Analytics não disponível:', err);
      }
    } catch (err) {
      console.error('Erro:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-3">
            <FileText size={32} />
            Contratos
          </h1>
        </div>

        <CreateContractForm />

        <div className="bg-slate-800 rounded-lg border border-slate-700 p-6 mt-8">
          <h2 className="text-2xl font-bold text-white mb-6">Contratos Cadastrados</h2>
          {loading ? (
            <p className="text-slate-400">Carregando...</p>
          ) : contracts.length === 0 ? (
            <p className="text-slate-400">Nenhum contrato</p>
          ) : (
            <div className="space-y-4">
              {contracts.map((contract: any) => (
                <div key={contract.id} className="p-4 bg-slate-700/50 rounded border border-slate-600">
                  <p className="text-white font-semibold">{contract.number}</p>
                  <p className="text-slate-400 text-sm">Status: {contract.status}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
