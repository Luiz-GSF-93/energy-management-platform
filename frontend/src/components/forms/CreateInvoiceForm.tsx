'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { api } from '@/lib/api/client';
import { Calculator, AlertCircle, CheckCircle, Loader } from 'lucide-react';

const invoiceSchema = z.object({
  consumerUnitId: z.string().min(1, 'UC obrigatória'),
  contractId: z.string().min(1, 'Contrato obrigatório'),
  referenceMonth: z.string().min(1, 'Período obrigatório'),
});

type InvoiceFormData = z.infer<typeof invoiceSchema>;

export default function CreateInvoiceForm() {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calculationResult, setCalculationResult] = useState<any>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<InvoiceFormData>({
    resolver: zodResolver(invoiceSchema),
  });

  const onSubmit = async (data: InvoiceFormData) => {
    setLoading(true);
    setError(null);

    try {
      const settlementData = {
        consumerUnitId: data.consumerUnitId,
        referenceMonth: new Date(data.referenceMonth),
        contractId: data.contractId,
      };

      const result = await api.settlements.calculate(settlementData);

      await api.invoices.create({
        contractId: data.contractId,
        consumerUnitId: data.consumerUnitId,
        referenceMonth: data.referenceMonth,
        status: 'EMITIDA',
        ...result,
      });

      setCalculationResult(result);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error('Erro ao calcular fatura:', err);
      setError(err instanceof Error ? err.message : 'Erro ao calcular fatura');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
      <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
        <Calculator size={24} />
        Motor de Cálculo de Fatura
      </h2>

      {error && (
        <div className="mb-6 p-4 bg-red-900/30 border border-red-500/50 rounded-lg flex items-center gap-2">
          <AlertCircle size={20} className="text-red-400" />
          <span className="text-red-200">{error}</span>
        </div>
      )}

      {success && (
        <div className="mb-6 p-4 bg-green-900/30 border border-green-500/50 rounded-lg flex items-center gap-2">
          <CheckCircle size={20} className="text-green-400" />
          <span className="text-green-200">✅ Fatura calculada e salva com sucesso!</span>
        </div>
      )}

      {calculationResult && (
        <div className="mb-8 grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="bg-slate-700/50 p-4 rounded-lg">
            <p className="text-slate-400 text-sm mb-1">Custo Regulado</p>
            <p className="text-blue-400 text-xl font-bold">
              R$ {(calculationResult.regulatedCost || 0).toLocaleString('pt-BR')}
            </p>
          </div>

          <div className="bg-slate-700/50 p-4 rounded-lg">
            <p className="text-slate-400 text-sm mb-1">Custo ACL</p>
            <p className="text-purple-400 text-xl font-bold">
              R$ {(calculationResult.aclCost || 0).toLocaleString('pt-BR')}
            </p>
          </div>

          <div className="bg-slate-700/50 p-4 rounded-lg">
            <p className="text-slate-400 text-sm mb-1">Economia Bruta</p>
            <p className="text-green-400 text-xl font-bold">
              R$ {(calculationResult.savings || 0).toLocaleString('pt-BR')}
            </p>
          </div>

          <div className="bg-slate-700/50 p-4 rounded-lg">
            <p className="text-slate-400 text-sm mb-1">% Economia</p>
            <p className="text-yellow-400 text-xl font-bold">
              {calculationResult.regulatedCost > 0
                ? ((calculationResult.savings / calculationResult.regulatedCost) * 100).toFixed(2)
                : '0.00'}
              %
            </p>
          </div>

          <div className="bg-slate-700/50 p-4 rounded-lg">
            <p className="text-slate-400 text-sm mb-1">ROI Anual</p>
            <p className="text-indigo-400 text-xl font-bold">
              {(calculationResult.roi || 0).toFixed(2)}%
            </p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Unidade Consumidora *
            </label>
            <input
              type="text"
              {...register('consumerUnitId')}
              placeholder="Selecionar UC"
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition"
            />
            {errors.consumerUnitId && (
              <p className="text-red-400 text-sm mt-1">{errors.consumerUnitId.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Contrato *
            </label>
            <input
              type="text"
              {...register('contractId')}
              placeholder="Selecionar Contrato"
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition"
            />
            {errors.contractId && (
              <p className="text-red-400 text-sm mt-1">{errors.contractId.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Período (Mês/Ano) *
            </label>
            <input
              type="month"
              {...register('referenceMonth')}
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition"
            />
            {errors.referenceMonth && (
              <p className="text-red-400 text-sm mt-1">{errors.referenceMonth.message}</p>
            )}
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white font-semibold rounded-lg flex items-center justify-center gap-2 transition"
        >
          {loading ? (
            <>
              <Loader size={20} className="animate-spin" />
              Calculando...
            </>
          ) : (
            <>
              <Calculator size={20} />
              Calcular Fatura
            </>
          )}
        </button>

        <div className="p-3 bg-slate-700/30 rounded text-slate-300 text-sm">
          <p>
            💡 <strong>Nota:</strong> Os dados de tarifa são automaticamente carregados do contrato.
            Apenas selecione UC, Contrato e Período.
          </p>
        </div>
      </form>
    </div>
  );
}
