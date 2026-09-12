'use client';

import { useState } from 'react';
import { Calculator, AlertCircle, CheckCircle, Loader } from 'lucide-react';

export default function CreateInvoiceForm() {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const handleCalculate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
      // Simulação - em produção seria chamar a API
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setResult({
        regulatedCost: 3398.40,
        aclCost: 3058.56,
        savings: 339.84,
        savingsPercent: 10,
        roi: 281.7
      });
      
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError('Erro ao calcular fatura');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Formulário */}
      <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
        <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
          <Calculator className="text-blue-400" />
          Motor de Cálculo de Fatura
        </h2>

        <form onSubmit={handleCalculate} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Unidade Consumidora</label>
              <input 
                type="text" 
                placeholder="Ex: 123456789" 
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Contrato</label>
              <input 
                type="text" 
                placeholder="Ex: CT-2026-001" 
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Período</label>
              <input 
                type="month" 
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:border-blue-500 focus:outline-none"
                required
              />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400">
              <AlertCircle size={20} />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400">
              <CheckCircle size={20} />
              <span>Fatura calculada com sucesso!</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white font-semibold rounded-lg flex items-center justify-center gap-2 transition"
          >
            {loading && <Loader size={20} className="animate-spin" />}
            {loading ? 'Calculando...' : 'Calcular Fatura'}
          </button>
        </form>
      </div>

      {/* Resultado */}
      {result && (
        <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
          <h3 className="text-lg font-bold text-white mb-4">Resultado do Cálculo</h3>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="bg-slate-700 rounded-lg p-4">
              <p className="text-sm text-slate-400">Custo Regulado</p>
              <p className="text-2xl font-bold text-white">R$ {result.regulatedCost.toFixed(2)}</p>
            </div>
            <div className="bg-slate-700 rounded-lg p-4">
              <p className="text-sm text-slate-400">Custo ACL</p>
              <p className="text-2xl font-bold text-white">R$ {result.aclCost.toFixed(2)}</p>
            </div>
            <div className="bg-slate-700 rounded-lg p-4">
              <p className="text-sm text-slate-400">Economia Bruta</p>
              <p className="text-2xl font-bold text-green-400">R$ {result.savings.toFixed(2)}</p>
            </div>
            <div className="bg-slate-700 rounded-lg p-4">
              <p className="text-sm text-slate-400">% Economia</p>
              <p className="text-2xl font-bold text-green-400">{result.savingsPercent}%</p>
            </div>
            <div className="bg-slate-700 rounded-lg p-4">
              <p className="text-sm text-slate-400">ROI Anual</p>
              <p className="text-2xl font-bold text-green-400">{result.roi}%</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
