'use client';

import { useState } from 'react';
import { api } from '@/lib/api/client';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

interface CalculationResult {
  referenceMonth: string;
  consumerUnitId: string;
  regulatedTotalCost: number;
  aclTotalCost: number;
  grossSavings: number;
  eligibleCosts: number;
  netSavings: number;
  managementFee: number;
  customerFinalSavings: number;
  savingsPercentage: number;
  roi: number;
  breakdown: Record<string, number>;
}

interface ChartData {
  name: string;
  value: number;
}

export function SettlementCalculator() {
  const [result, setResult] = useState<CalculationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCalculate = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await api.settlements.calculate({
        consumerUnitId: 'uc-001',
        referenceMonth: '2026-01-01',
        consumptionMwh: 100,
        regulatedEnergyPrice: 500,
        regulatedTusdCost: 5000,
        regulatedTaxes: 2000,
        contractedPrice: 450,
        cceeCost: 1000,
        chargesCost: 500,
        taxesCost: 800,
        remunerationModel: 'HYBRID',
        fixedFee: 500,
        variablePercentage: 25,
      });

      if (response.statusCode === 200 && response.data) {
        setResult(response.data as CalculationResult);
      } else {
        setError('Erro ao calcular apuração');
      }
    } catch (err: any) {
      setError(err.message || 'Erro na requisição');
    } finally {
      setLoading(false);
    }
  };

  const costData: ChartData[] = result
    ? [
        { name: 'Regulado', value: result.regulatedTotalCost },
        { name: 'ACL', value: result.aclTotalCost },
      ]
    : [];

  const savingsData: ChartData[] = result
    ? [
        { name: 'Bruta', value: result.grossSavings },
        { name: 'Tributos', value: result.eligibleCosts },
        { name: 'Líquida', value: result.netSavings },
      ]
    : [];

  const COLORS = ['#ff6b6b', '#4ecdc4', '#45b7d1'];

  return (
    <div className="space-y-6 p-6 bg-white dark:bg-gray-900 rounded-lg shadow">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          Calculadora de Apuração
        </h2>
        <button
          onClick={handleCalculate}
          disabled={loading}
          className="bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 text-white px-6 py-2 rounded transition"
        >
          {loading ? 'Calculando...' : 'Calcular'}
        </button>
      </div>

      {error && (
        <div className="bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-100 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-6">
          {/* Cards de Resumo */}
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded">
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                Custo Regulado
              </p>
              <p className="text-gray-900 dark:text-white text-2xl font-bold">
                R$ {result.regulatedTotalCost.toLocaleString('pt-BR')}
              </p>
            </div>
            <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded">
              <p className="text-gray-600 dark:text-gray-400 text-sm">Custo ACL</p>
              <p className="text-gray-900 dark:text-white text-2xl font-bold">
                R$ {result.aclTotalCost.toLocaleString('pt-BR')}
              </p>
            </div>
            <div className="bg-green-100 dark:bg-green-900 p-4 rounded">
              <p className="text-green-700 dark:text-gray-400 text-sm">
                Economia Bruta
              </p>
              <p className="text-green-700 dark:text-green-400 text-2xl font-bold">
                R$ {result.grossSavings.toLocaleString('pt-BR')}
              </p>
            </div>
            <div className="bg-blue-100 dark:bg-blue-900 p-4 rounded">
              <p className="text-blue-700 dark:text-gray-400 text-sm">ROI</p>
              <p className="text-blue-700 dark:text-blue-400 text-2xl font-bold">
                {result.roi.toFixed(2)}%
              </p>
            </div>
          </div>

          {/* Gráficos */}
          <div className="grid grid-cols-2 gap-6">
            {/* Comparação de Custos */}
            <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded">
              <h3 className="text-gray-900 dark:text-white font-bold mb-4">
                Comparação de Custos
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={costData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" stroke="#999" />
                  <YAxis stroke="#999" />
                  <Tooltip />
                  <Bar dataKey="value" fill="#ff6b6b" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Breakdown de Economia */}
            <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded">
              <h3 className="text-gray-900 dark:text-white font-bold mb-4">
                Composição da Economia
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={savingsData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) =>
                      `${name}: R$ ${(value as number).toLocaleString('pt-BR')}`
                    }
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {COLORS.map((color, index) => (
                      <Cell key={`cell-${index}`} fill={color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Detalhes Financeiros */}
          <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded space-y-3">
            <h3 className="text-gray-900 dark:text-white font-bold">
              Detalhes Financeiros
            </h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">
                  Economia Líquida:
                </span>
                <span className="text-gray-900 dark:text-white font-bold">
                  R$ {result.netSavings.toLocaleString('pt-BR')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">
                  Remuneração Gestora:
                </span>
                <span className="text-orange-600 dark:text-orange-400 font-bold">
                  R$ {result.managementFee.toLocaleString('pt-BR')}
                </span>
              </div>
              <div className="flex justify-between col-span-2 border-t border-gray-300 dark:border-gray-700 pt-2">
                <span className="text-gray-600 dark:text-gray-400">
                  Economia Final Cliente:
                </span>
                <span className="text-green-600 dark:text-green-400 font-bold text-lg">
                  R$ {result.customerFinalSavings.toLocaleString('pt-BR')}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
