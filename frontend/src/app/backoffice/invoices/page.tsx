'use client';

import { useState } from 'react';
import { FileText, Calculator, TrendingUp } from 'lucide-react';

interface InvoiceData {
  // IDENTIFICAÇÃO
  invoiceNumber: string;
  consumerUnit: string;
  referenceMonth: string;
  contractNumber: string;
  
  // CONSUMO
  consumptionPeakHours: number;
  consumptionOffPeakHours: number;
  demandPeak: number;
  demandOffPeak: number;
  
  // TARIFAS (vinculadas do contrato)
  tusdPeakRate: number;
  tusdOffPeakRate: number;
  tusdDemandPeak: number;
  tusdDemandOffPeak: number;
  tePeakRate: number;
  teOffPeakRate: number;
  
  // ENCARGOS
  bandeiraPeak: number;
  bandeiraOffPeak: number;
  ccee: number;
  onu: number;
  pes: number;
  
  // IMPOSTOS
  icms: number;
  pis: number;
  cofins: number;
  
  // CRÉDITOS
  creditAmount: number;
  
  // COMPARATIVO ACL
  aclPeakRate: number;
  aclOffPeakRate: number;
}

const initialData: InvoiceData = {
  invoiceNumber: 'NF-2026-001',
  consumerUnit: '123456789',
  referenceMonth: '2026-09',
  contractNumber: 'CT-2026-001',
  consumptionPeakHours: 500,
  consumptionOffPeakHours: 1500,
  demandPeak: 50,
  demandOffPeak: 30,
  tusdPeakRate: 0.85,
  tusdOffPeakRate: 0.50,
  tusdDemandPeak: 25.00,
  tusdDemandOffPeak: 15.00,
  tePeakRate: 150.00,
  teOffPeakRate: 100.00,
  bandeiraPeak: 0.08,
  bandeiraOffPeak: 0.02,
  ccee: 2.50,
  onu: 0.15,
  pes: 0.45,
  icms: 0.18,
  pis: 0.0765,
  cofins: 0.076,
  creditAmount: 0,
  aclPeakRate: 120.00,
  aclOffPeakRate: 80.00,
};

export default function InvoicesPage() {
  const [formData, setFormData] = useState<InvoiceData>(initialData);
  const [results, setResults] = useState<any>(null);

  const calculateInvoice = () => {
    // REGULADO - Cálculo de energia
    const tusdEnergy = 
      (formData.consumptionPeakHours * formData.tusdPeakRate) +
      (formData.consumptionOffPeakHours * formData.tusdOffPeakRate);
    
    const teEnergy = 
      (formData.consumptionPeakHours * formData.tePeakRate / 1000) +
      (formData.consumptionOffPeakHours * formData.teOffPeakRate / 1000);
    
    const bandeira = 
      (formData.consumptionPeakHours * formData.bandeiraPeak) +
      (formData.consumptionOffPeakHours * formData.bandeiraOffPeak);
    
    const demand = 
      (formData.demandPeak * formData.tusdDemandPeak) +
      (formData.demandOffPeak * formData.tusdDemandOffPeak);
    
    const chargesSubtotal = formData.ccee + formData.onu + formData.pes;
    
    const regulatedSubtotal = tusdEnergy + teEnergy + bandeira + demand + chargesSubtotal;
    
    // Aplicar impostos (sobre base tributária)
    const taxRate = (formData.icms + formData.pis + formData.cofins);
    const taxes = regulatedSubtotal * taxRate;
    
    // Créditos
    const regulatedTotal = (regulatedSubtotal + taxes) - formData.creditAmount;

    // ACL - Cálculo para comparativo
    const aclEnergy = 
      (formData.consumptionPeakHours * formData.aclPeakRate / 1000) +
      (formData.consumptionOffPeakHours * formData.aclOffPeakRate / 1000);
    
    const aclDemand = (formData.demandPeak + formData.demandOffPeak) * 20; // Taxa média
    const aclDistribution = (formData.consumptionPeakHours + formData.consumptionOffPeakHours) * 0.60;
    const aclSubtotal = aclEnergy + aclDemand + aclDistribution;
    const aclTaxes = aclSubtotal * taxRate;
    const aclTotal = (aclSubtotal + aclTaxes) - formData.creditAmount;

    // Economia
    const monthlyEconomy = regulatedTotal - aclTotal;
    const annualEconomy = monthlyEconomy * 12;
    const economyPercent = (monthlyEconomy / regulatedTotal * 100).toFixed(1);

    setResults({
      regulatedBreakdown: {
        tusdEnergy: tusdEnergy.toFixed(2),
        teEnergy: teEnergy.toFixed(2),
        bandeira: bandeira.toFixed(2),
        demand: demand.toFixed(2),
        charges: chargesSubtotal.toFixed(2),
        subtotal: regulatedSubtotal.toFixed(2),
        taxes: taxes.toFixed(2),
      },
      regulatedTotal: regulatedTotal.toFixed(2),
      aclTotal: aclTotal.toFixed(2),
      monthlyEconomy: monthlyEconomy.toFixed(2),
      annualEconomy: annualEconomy.toFixed(2),
      economyPercent,
    });
  };

  const handleChange = (field: keyof InvoiceData, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: isNaN(value) ? value : parseFloat(value) || 0
    }));
  };

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-3">
          <FileText size={32} className="text-blue-400" />
          Faturas
        </h1>
        <p className="text-slate-400 mb-8">Registre e calcule faturas de energia com comparativo regulado vs ACL</p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* FORMULÁRIO */}
          <div className="lg:col-span-1">
            <div className="bg-slate-800 rounded-lg p-6 border border-slate-700 sticky top-6">
              <h2 className="text-xl font-bold text-white mb-4">Registrar Fatura</h2>
              
              <div className="space-y-4 max-h-96 overflow-y-auto">
                <div className="text-sm font-semibold text-blue-400">Identificação</div>
                <input 
                  type="text" 
                  placeholder="Número da Fatura"
                  value={formData.invoiceNumber}
                  onChange={(e) => handleChange('invoiceNumber', e.target.value)}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                />
                <input 
                  type="text" 
                  placeholder="UC"
                  value={formData.consumerUnit}
                  onChange={(e) => handleChange('consumerUnit', e.target.value)}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                />
                <input 
                  type="month" 
                  value={formData.referenceMonth}
                  onChange={(e) => handleChange('referenceMonth', e.target.value)}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                />

                <div className="text-sm font-semibold text-green-400">Consumo (kWh)</div>
                <input 
                  type="number" 
                  placeholder="Consumo Ponta"
                  value={formData.consumptionPeakHours}
                  onChange={(e) => handleChange('consumptionPeakHours', e.target.value)}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                />
                <input 
                  type="number" 
                  placeholder="Consumo Fora Ponta"
                  value={formData.consumptionOffPeakHours}
                  onChange={(e) => handleChange('consumptionOffPeakHours', e.target.value)}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                />

                <div className="text-sm font-semibold text-yellow-400">Demanda (kW)</div>
                <input 
                  type="number" 
                  placeholder="Demanda Ponta"
                  value={formData.demandPeak}
                  onChange={(e) => handleChange('demandPeak', e.target.value)}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                />
                <input 
                  type="number" 
                  placeholder="Demanda Fora Ponta"
                  value={formData.demandOffPeak}
                  onChange={(e) => handleChange('demandOffPeak', e.target.value)}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                />

                <button
                  onClick={calculateInvoice}
                  className="w-full mt-4 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded flex items-center justify-center gap-2"
                >
                  <Calculator size={20} />
                  Calcular Fatura
                </button>
              </div>
            </div>
          </div>

          {/* RESULTADOS */}
          <div className="lg:col-span-2 space-y-6">
            {results && (
              <>
                {/* KPIs */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                    <p className="text-slate-400 text-sm">Regulado</p>
                    <p className="text-2xl font-bold text-white">R$ {results.regulatedTotal}</p>
                  </div>
                  <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                    <p className="text-slate-400 text-sm">ACL</p>
                    <p className="text-2xl font-bold text-blue-400">R$ {results.aclTotal}</p>
                  </div>
                  <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                    <p className="text-slate-400 text-sm">Economia/mês</p>
                    <p className="text-2xl font-bold text-green-400">R$ {results.monthlyEconomy}</p>
                  </div>
                  <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                    <p className="text-slate-400 text-sm">Economia/ano</p>
                    <p className="text-2xl font-bold text-green-500">R$ {results.annualEconomy}</p>
                  </div>
                </div>

                {/* Detalhes Regulado */}
                <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                  <h3 className="text-lg font-bold text-white mb-4">Fatura Regulada - Detalhamento</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-400">TUSD Energia</span>
                      <span className="text-white">R$ {results.regulatedBreakdown.tusdEnergy}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">TE Energia</span>
                      <span className="text-white">R$ {results.regulatedBreakdown.teEnergy}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Bandeira</span>
                      <span className="text-white">R$ {results.regulatedBreakdown.bandeira}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Demanda</span>
                      <span className="text-white">R$ {results.regulatedBreakdown.demand}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Encargos (CCEE, ONU, PES)</span>
                      <span className="text-white">R$ {results.regulatedBreakdown.charges}</span>
                    </div>
                    <div className="border-t border-slate-700 pt-2 mt-2 flex justify-between font-bold">
                      <span className="text-slate-300">Subtotal</span>
                      <span className="text-white">R$ {results.regulatedBreakdown.subtotal}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Impostos (ICMS + PIS + COFINS)</span>
                      <span className="text-yellow-400">R$ {results.regulatedBreakdown.taxes}</span>
                    </div>
                    <div className="border-t border-slate-700 pt-2 mt-2 flex justify-between font-bold text-lg">
                      <span className="text-white">TOTAL</span>
                      <span className="text-green-400">R$ {results.regulatedTotal}</span>
                    </div>
                  </div>
                </div>

                {/* Comparativo */}
                <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                  <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <TrendingUp size={24} className="text-green-400" />
                    Economia Potencial
                  </h3>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <p className="text-slate-400 text-sm">% Economia</p>
                      <p className="text-3xl font-bold text-green-400">{results.economyPercent}%</p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-sm">Mensal</p>
                      <p className="text-3xl font-bold text-blue-400">R$ {results.monthlyEconomy}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-sm">Anual</p>
                      <p className="text-3xl font-bold text-purple-400">R$ {results.annualEconomy}</p>
                    </div>
                  </div>
                </div>
              </>
            )}

            {!results && (
              <div className="bg-slate-800 rounded-lg p-12 border border-slate-700 text-center">
                <p className="text-slate-400">Preencha os dados da fatura e clique em "Calcular" para gerar o comparativo</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
