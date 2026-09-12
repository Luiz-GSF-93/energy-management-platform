'use client';

import { useState } from 'react';
import { FileText, Save, Download, TrendingUp } from 'lucide-react';

interface ContractData {
  // Identificação
  contractNumber: string;
  clientName: string;
  distributor: string;
  consumerUnit: string;
  
  // Regulado - TUSD (Tarifa de Uso do Sistema de Distribuição)
  tusdPeakRate: number;
  tusdOffPeakRate: number;
  tusdDemandRate: number;
  
  // Regulado - TE (Tarifa de Energia)
  tePeakRate: number;
  teOffPeakRate: number;
  
  // Regulado - Encargos
  bandeiraPeak: number;
  bandeiraOffPeak: number;
  cceeContribution: number;
  onuContribution: number;
  pesContribution: number;
  
  // Regulado - Impostos
  pisFederal: number;
  cofinsFederal: number;
  icmsState: number;
  
  // Mercado Livre - Geração
  acePeakRate: number;
  aceOffPeakRate: number;
  
  // Mercado Livre - Distribuição
  aclDistributionPeak: number;
  aclDistributionOffPeak: number;
  aclDemandRate: number;
  
  // Consumo mensal
  consumptionPeak: number;
  consumptionOffPeak: number;
  contractedDemand: number;
  
  // Performace anual
  annualConsumption: number;
}

const initialData: ContractData = {
  contractNumber: 'CT-2026-001',
  clientName: 'Empresa XYZ LTDA',
  distributor: 'CPFL Energia',
  consumerUnit: '123456789',
  tusdPeakRate: 0.85,
  tusdOffPeakRate: 0.50,
  tusdDemandRate: 25.00,
  tePeakRate: 150.00,
  teOffPeakRate: 100.00,
  bandeiraPeak: 0.08,
  bandeiraOffPeak: 0.02,
  cceeContribution: 2.50,
  onuContribution: 0.15,
  pesContribution: 0.45,
  pisFederal: 0.0765,
  cofinsFederal: 0.076,
  icmsState: 0.18,
  acePeakRate: 120.00,
  aceOffPeakRate: 80.00,
  aclDistributionPeak: 0.75,
  aclDistributionOffPeak: 0.45,
  aclDemandRate: 22.00,
  consumptionPeak: 500,
  consumptionOffPeak: 300,
  contractedDemand: 50,
  annualConsumption: 9600,
};

export default function ContractsPage() {
  const [formData, setFormData] = useState<ContractData>(initialData);
  const [results, setResults] = useState<any>(null);

  const calculateComparison = () => {
    // Cálculo Regulado (mensalmente)
    const regulatedCost = (
      (formData.consumptionPeak * (formData.tusdPeakRate + formData.tePeakRate)) +
      (formData.consumptionOffPeak * (formData.tusdOffPeakRate + formData.teOffPeakRate)) +
      (formData.contractedDemand * formData.tusdDemandRate) +
      ((formData.consumptionPeak + formData.consumptionOffPeak) * (formData.bandeiraPeak + formData.bandeiraOffPeak)) +
      (formData.cceeContribution + formData.onuContribution + formData.pesContribution)
    );

    // Impostos
    const taxBase = regulatedCost;
    const taxes = taxBase * (formData.pisFederal + formData.cofinsFederal + formData.icmsState);
    const regulatedTotal = regulatedCost + taxes;

    // Cálculo Mercado Livre (ACL)
    const aclCost = (
      (formData.consumptionPeak * (formData.acePeakRate + formData.aclDistributionPeak)) +
      (formData.consumptionOffPeak * (formData.aceOffPeakRate + formData.aclDistributionOffPeak)) +
      (formData.contractedDemand * formData.aclDemandRate)
    );

    const aclTaxes = aclCost * (formData.pisFederal + formData.cofinsFederal + formData.icmsState);
    const aclTotal = aclCost + aclTaxes;

    // Economia
    const monthlySavings = regulatedTotal - aclTotal;
    const annualSavings = monthlySavings * 12;
    const savingsPercent = (monthlySavings / regulatedTotal) * 100;
    const roi = (annualSavings / 5000) * 100; // Assumindo investimento de R$ 5.000

    setResults({
      regulatedCost,
      regulatedTaxes: taxes,
      regulatedTotal,
      aclCost,
      aclTaxes,
      aclTotal,
      monthlySavings,
      annualSavings,
      savingsPercent: savingsPercent.toFixed(1),
      roi: roi.toFixed(1),
    });
  };

  const handleChange = (field: keyof ContractData, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: isNaN(value) ? value : parseFloat(value) || 0
    }));
  };

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-3">
          <FileText size={32} className="text-blue-400" />
          Contratos
        </h1>
        <p className="text-slate-400 mb-8">Cadastro e simulação de contratos com análise de mercado regulado vs livre</p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* FORMULÁRIO */}
          <div className="lg:col-span-1">
            <div className="bg-slate-800 rounded-lg p-6 border border-slate-700 sticky top-6">
              <h2 className="text-xl font-bold text-white mb-4">Criar Contrato</h2>
              
              <div className="space-y-4 max-h-96 overflow-y-auto">
                {/* Identificação */}
                <div className="text-sm font-semibold text-blue-400">Identificação</div>
                <input 
                  type="text" 
                  placeholder="Número do Contrato"
                  value={formData.contractNumber}
                  onChange={(e) => handleChange('contractNumber', e.target.value)}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                />
                <input 
                  type="text" 
                  placeholder="Cliente"
                  value={formData.clientName}
                  onChange={(e) => handleChange('clientName', e.target.value)}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                />
                <input 
                  type="text" 
                  placeholder="Distribuidora"
                  value={formData.distributor}
                  onChange={(e) => handleChange('distributor', e.target.value)}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                />

                {/* TUSD */}
                <div className="text-sm font-semibold text-green-400">TUSD (R$/kWh)</div>
                <input 
                  type="number" 
                  placeholder="Ponta"
                  value={formData.tusdPeakRate}
                  onChange={(e) => handleChange('tusdPeakRate', e.target.value)}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                  step="0.01"
                />
                <input 
                  type="number" 
                  placeholder="Fora Ponta"
                  value={formData.tusdOffPeakRate}
                  onChange={(e) => handleChange('tusdOffPeakRate', e.target.value)}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                  step="0.01"
                />
                <input 
                  type="number" 
                  placeholder="Demanda (R$/kW)"
                  value={formData.tusdDemandRate}
                  onChange={(e) => handleChange('tusdDemandRate', e.target.value)}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                  step="0.01"
                />

                {/* TE */}
                <div className="text-sm font-semibold text-yellow-400">TE (R$/MWh)</div>
                <input 
                  type="number" 
                  placeholder="Ponta"
                  value={formData.tePeakRate}
                  onChange={(e) => handleChange('tePeakRate', e.target.value)}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                  step="0.01"
                />
                <input 
                  type="number" 
                  placeholder="Fora Ponta"
                  value={formData.teOffPeakRate}
                  onChange={(e) => handleChange('teOffPeakRate', e.target.value)}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                  step="0.01"
                />

                {/* Consumo */}
                <div className="text-sm font-semibold text-purple-400">Consumo (kWh/mês)</div>
                <input 
                  type="number" 
                  placeholder="Ponta"
                  value={formData.consumptionPeak}
                  onChange={(e) => handleChange('consumptionPeak', e.target.value)}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                />
                <input 
                  type="number" 
                  placeholder="Fora Ponta"
                  value={formData.consumptionOffPeak}
                  onChange={(e) => handleChange('consumptionOffPeak', e.target.value)}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                />

                {/* Botões */}
                <button
                  onClick={calculateComparison}
                  className="w-full mt-4 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded flex items-center justify-center gap-2"
                >
                  <TrendingUp size={20} />
                  Calcular Simulação
                </button>
                <button
                  className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded flex items-center justify-center gap-2"
                >
                  <Save size={20} />
                  Salvar Contrato
                </button>
              </div>
            </div>
          </div>

          {/* RESULTADOS */}
          <div className="lg:col-span-2 space-y-6">
            {results && (
              <>
                {/* KPI Cards */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                    <p className="text-slate-400 text-sm">Custo Regulado/mês</p>
                    <p className="text-2xl font-bold text-white">R$ {results.regulatedTotal.toFixed(2)}</p>
                  </div>
                  <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                    <p className="text-slate-400 text-sm">Custo ACL/mês</p>
                    <p className="text-2xl font-bold text-blue-400">R$ {results.aclTotal.toFixed(2)}</p>
                  </div>
                  <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                    <p className="text-slate-400 text-sm">Economia/mês</p>
                    <p className="text-2xl font-bold text-green-400">R$ {results.monthlySavings.toFixed(2)}</p>
                  </div>
                  <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                    <p className="text-slate-400 text-sm">Economia/ano</p>
                    <p className="text-2xl font-bold text-green-500">R$ {results.annualSavings.toFixed(2)}</p>
                  </div>
                  <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                    <p className="text-slate-400 text-sm">% Economia</p>
                    <p className="text-2xl font-bold text-yellow-400">{results.savingsPercent}%</p>
                  </div>
                  <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                    <p className="text-slate-400 text-sm">ROI Anual</p>
                    <p className="text-2xl font-bold text-purple-400">{results.roi}%</p>
                  </div>
                </div>

                {/* Detalhes */}
                <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                  <h3 className="text-lg font-bold text-white mb-4">Comparativo Detalhado</h3>
                  <table className="w-full text-sm">
                    <tbody>
                      <tr className="border-b border-slate-700">
                        <td className="py-2 text-slate-400">Tarifa de Energia (TE)</td>
                        <td className="py-2 text-right font-semibold">R$ {results.regulatedCost.toFixed(2)}</td>
                        <td className="py-2 text-right font-semibold text-blue-400">R$ {results.aclCost.toFixed(2)}</td>
                      </tr>
                      <tr className="border-b border-slate-700">
                        <td className="py-2 text-slate-400">Impostos (PIS/COFINS/ICMS)</td>
                        <td className="py-2 text-right font-semibold">R$ {results.regulatedTaxes.toFixed(2)}</td>
                        <td className="py-2 text-right font-semibold text-blue-400">R$ {results.aclTaxes.toFixed(2)}</td>
                      </tr>
                      <tr>
                        <td className="py-2 text-white font-bold">TOTAL</td>
                        <td className="py-2 text-right font-bold">R$ {results.regulatedTotal.toFixed(2)}</td>
                        <td className="py-2 text-right font-bold text-green-400">R$ {results.aclTotal.toFixed(2)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Exportar */}
                <button
                  className="w-full px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded flex items-center justify-center gap-2"
                >
                  <Download size={20} />
                  Exportar Relatório (PDF)
                </button>
              </>
            )}

            {!results && (
              <div className="bg-slate-800 rounded-lg p-12 border border-slate-700 text-center">
                <p className="text-slate-400">Preencha os dados e clique em "Calcular Simulação" para ver os resultados</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
