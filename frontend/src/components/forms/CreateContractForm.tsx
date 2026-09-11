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
  const [error, setError] = useState<string | null>(null);
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
      monthlyFee: 0,
      commissionPercentage: 0,
      startDate: new Date().toISOString().split('T')[0],
      contractType: 'STANDARD',
    },
  });

  const onSubmit = async (data: any) => {
    setLoading(true);
    setError(null);

    try {
      const response = await api.contracts.create(data);
      
      if (response.statusCode === 201 && response.data) {
        onSuccess?.(response.data as Contract);
        reset();
      } else {
        setError('Erro ao criar contrato');
        onError?.('Erro ao criar contrato');
      }
    } catch (err: any) {
      const errorMsg = err.message || 'Erro ao criar contrato';
      setError(errorMsg);
      onError?.(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 bg-white p-6 rounded-lg shadow">
      <h2 className="text-2xl font-bold text-gray-800">Novo Contrato</h2>

      {error && (
        <div className="p-4 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Número do Contrato *
          </label>
          <input
            {...register('contractNumber', {
              required: 'Obrigatório',
              minLength: { value: 3, message: 'Mínimo 3 caracteres' },
              maxLength: { value: 50, message: 'Máximo 50 caracteres' },
            })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="CT-001"
          />
          {errors.contractNumber && (
            <span className="text-red-500 text-sm">{errors.contractNumber.message}</span>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Título do Contrato *
          </label>
          <input
            {...register('contractTitle', {
              required: 'Obrigatório',
              minLength: { value: 3, message: 'Mínimo 3 caracteres' },
            })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Contrato de Energia Padrão"
          />
          {errors.contractTitle && (
            <span className="text-red-500 text-sm">{errors.contractTitle.message}</span>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
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
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="1000"
          />
          {errors.monthlyFee && (
            <span className="text-red-500 text-sm">{errors.monthlyFee.message}</span>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
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
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="5.5"
          />
          {errors.commissionPercentage && (
            <span className="text-red-500 text-sm">{errors.commissionPercentage.message}</span>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Data de Início *
          </label>
          <input
            type="date"
            {...register('startDate', { required: 'Obrigatório' })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {errors.startDate && (
            <span className="text-red-500 text-sm">{errors.startDate.message}</span>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Tipo de Contrato *
          </label>
          <select
            {...register('contractType')}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
          className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition"
        >
          {loading ? 'Salvando...' : 'Criar Contrato'}
        </button>
        <button
          type="button"
          onClick={() => reset()}
          className="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-400 font-medium transition"
        >
          Limpar
        </button>
      </div>
    </form>
  );
}
