'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { api } from '@/lib/api/client';
import { Contract } from '@/types/api';

interface CreateContractFormProps {
  onSuccess?: (contract: Contract) => void;
  onError?: (error: string) => void;
}

export function CreateContractForm({
  onSuccess,
  onError,
}: CreateContractFormProps) {
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm({
    mode: 'onBlur',
    defaultValues: {
      contractNumber: '',
      contractTitle: '',
      monthlyFee: 1000,
      commissionPercentage: 5,
      startDate: new Date().toISOString().split('T')[0],
      contractType: 'STANDARD',
    },
  });

  const onSubmit = async (data: any) => {
    setLoading(true);
    setApiError(null);

    try {
      console.log('Enviando dados:', data);
      const response = await api.contracts.create(data);
      console.log('Resposta:', response);
      
      if (response.statusCode === 201 && response.data) {
        onSuccess?.(response.data as Contract);
        reset();
      } else {
        const errorMsg = response.message || 'Erro ao criar contrato';
        setApiError(errorMsg);
        onError?.(errorMsg);
      }
    } catch (err: any) {
      const errorMsg = err.message || 'Erro ao criar contrato';
      console.error('Erro:', errorMsg);
      setApiError(errorMsg);
      onError?.(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 bg-slate-800 p-6 rounded-lg shadow-lg border border-slate-700">
      <h2 className="text-2xl font-bold text-white">Novo Contrato</h2>

      {apiError && (
        <div className="p-4 bg-red-900/50 border border-red-700 text-red-200 rounded">
          ⚠️ {apiError}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold text-slate-300 mb-2">
            Número do Contrato *
          </label>
          <input
            {...register('contractNumber', {
              required: 'Obrigatório',
              minLength: { value: 3, message: 'Mínimo 3 caracteres' },
              maxLength: { value: 50, message: 'Máximo 50 caracteres' },
            })}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 text-white placeholder-slate-500"
            placeholder="CT-001"
          />
          {errors.contractNumber && (
            <span className="text-red-400 text-sm mt-1">{errors.contractNumber.message}</span>
          )}
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-300 mb-2">
            Título do Contrato *
          </label>
          <input
            {...register('contractTitle', {
              required: 'Obrigatório',
              minLength: { value: 3, message: 'Mínimo 3 caracteres' },
            })}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 text-white placeholder-slate-500"
            placeholder="Contrato de Energia Padrão"
          />
          {errors.contractTitle && (
            <span className="text-red-400 text-sm mt-1">{errors.contractTitle.message}</span>
          )}
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-300 mb-2">
            Taxa Mensal (R$) *
          </label>
          <input
            type="number"
            step="0.01"
            {...register('monthlyFee', {
              required: 'Obrigatório',
              min: { value: 1, message: 'Deve ser maior que 0' },
              valueAsNumber: true,
            })}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 text-white placeholder-slate-500"
            placeholder="1000"
          />
          {errors.monthlyFee && (
            <span className="text-red-400 text-sm mt-1">{errors.monthlyFee.message}</span>
          )}
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-300 mb-2">
            Comissão (%) *
          </label>
          <input
            type="number"
            step="0.01"
            {...register('commissionPercentage', {
              required: 'Obrigatório',
              min: { value: 0, message: 'Não pode ser negativa' },
              max: { value: 100, message: 'Não pode exceder 100%' },
              valueAsNumber: true,
            })}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 text-white placeholder-slate-500"
            placeholder="5.5"
          />
          {errors.commissionPercentage && (
            <span className="text-red-400 text-sm mt-1">{errors.commissionPercentage.message}</span>
          )}
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-300 mb-2">
            Data de Início *
          </label>
          <input
            type="date"
            {...register('startDate', { required: 'Obrigatório' })}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 text-white"
          />
          {errors.startDate && (
            <span className="text-red-400 text-sm mt-1">{errors.startDate.message}</span>
          )}
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-300 mb-2">
            Tipo de Contrato *
          </label>
          <select
            {...register('contractType')}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 text-white"
          >
            <option value="STANDARD">Padrão</option>
            <option value="PREFERENCIAL">Preferencial</option>
          </select>
        </div>
      </div>

      <div className="flex gap-4">
        <button
          type="submit"
          disabled={loading}
          className="flex-1 bg-orange-600 text-white py-2 px-4 rounded-md hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold transition shadow-lg"
        >
          {loading ? '⏳ Salvando...' : '✓ Criar Contrato'}
        </button>
        <button
          type="button"
          onClick={() => reset()}
          className="flex-1 bg-slate-700 text-slate-200 py-2 px-4 rounded-md hover:bg-slate-600 font-semibold transition"
        >
          Limpar
        </button>
      </div>
    </form>
  );
}
