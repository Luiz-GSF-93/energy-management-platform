'use client';

import { useState } from 'react';

interface CalculationResult {
  referenceMonth: string;
  consumerUnitId: string;
  regulatedTotalCost: number;
  aclTotalCost: number;
  grossSavings: number;
  netSavings: number;
  roi: number;
}

export default function SettlementCalculator() {
  const [result, setResult] = useState<CalculationResult | null>(null);

  return (
    <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
      <h2 className="text-xl font-bold text-white mb-4">Calculadora de Liquidação</h2>
      <p className="text-slate-400">Componente simplificado</p>
    </div>
  );
}
