'use client';

import { useState } from 'react';
import { FileText, Calculator, TrendingUp, ChevronDown, ChevronUp } from 'lucide-react';

interface InvoiceData {
  invoiceNumber: string;
  consumerUnit: string;
  referenceMonth: string;
  contractNumber: string;
  distributor: string;
  consumptionPeakHours: number;
  consumptionPeakkWh: number;
  consumptionOffPeakHours: number;
  consumptionOffPeakkWh: number;
  demandPeak: number;
  demandOffPeak: number;
  demandUnique: number;
  tusdPeakRate: number;
  tusdOffPeakRate: number;
  tusdDemandPeak: number;
  tusdDemandOffPeak: number;
  tePeakRate: number;
  teOffPeakRate: number;
  bandeiraPeak: number;
  bandeiraOffPeak: number;
  ccee: number;
  onu: number;
  pes: number;
  rge: number;
  reserveEnergyRate: number;
  reserveEnergyConsumption: number;
  icms: number;
  pis: number;
  cofins: number;
  taxMunicipality: number;
  creditAmount: number;
  creditDescription: string;
  aclPeakRate: number;
  aclOffPeakRate: number;
  aclDemandPeak: number;
  aclDemandOffPeak: number;
}

type SectionKey = 'identification' | 'consumption' | 'demand' | 'charges' | 'taxes' | 'acl';

interface ExpandedSections {
  identification: boolean;
  consumption: boolean;
  demand: boolean;
  charges: boolean;
  taxes: boolean;
  acl: boolean;
}

const initialData: InvoiceData = {
  invoiceNumber: 'NF-2026-001',
  consumerUnit: '123456789',
  referenceMonth: '2026-09',
  contractNumber: 'CT-2026-001',
  distributor: 'CPFL Energia',
  consumptionPeakHours: 500,
  consumptionPeakkWh: 500,
  consumptionOffPeakHours: 1500,
  consumptionOffPeakkWh: 1500,
  demandPeak: 50,
  demandOffPeak: 30,
  demandUnique: 0,
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
  rge: 0.20,
  reserveEnergyRate: 0.50,
  reserveEnergyConsumption: 0,
  icms: 0.18,
  pis: 0.0765,
  cofins: 0.076,
  taxMunicipality: 0.05,
  creditAmount: 0,
  creditDescription: '',
  aclPeakRate: 120.00,
  aclOffPeakRate: 80.00,
  aclDemandPeak: 22.00,
  aclDemandOffPeak: 12.00,
};

export default function InvoicesPage() {
  const [formData, setFormData] = useState<InvoiceData>(initialData);
  const [results, setResults] = useState<any>(null);
  const [expandedSections, setExpandedSections] = useState<ExpandedSections>({
    identification: true,
    consumption: true,
    demand: false,
    charges: false,
    taxes: false,
    acl: false,
  });

  const toggleSection = (section: SectionKey) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const calculateInvoice = () => {
    const tusdEnergyPeak = formData.consumptionPeakkWh * formData.tusdPeakRate;
    const tusdEnergyOffPeak = formData.consumptionOffPeakkWh * formData.tusdOffPeakRate;
    const tusdEnergy = tusdEnergyPeak + tusdEnergyOffPeak;

    const teEnergyPeak = (formData.consumptionPeakHours * formData.tePeakRate) / 1000;
    const teEnergyOffPeak = (formData.consumptionOffPeakHours * formData.teOffPeakRate) / 1000;
    const teEnergy = teEnergyPeak + teEnergyOffPeak;

    const bandeiraPeak = formData.consumptionPeakkWh * formData.bandeiraPeak;
    const bandeiraOffPeak = formData.consumptionOffPeakkWh * formData.bandeiraOffPeak;
    const bandeira = bandeiraPeak + bandeiraOffPeak;

    const demandCost = (formData.demandPeak * formData.tusdDemandPeak) + 
                       (formData.demandOffPeak * formData.tusdDemandOffPeak);

    const chargesTotal = formData.ccee + formData.onu + formData.pes + formData.rge;
    const reserveEnergyCost = formData.reserveEnergyConsumption * formData.reserveEnergyRate;
    const regulatedSubtotal = tusdEnergy + teEnergy + bandeira + demandCost + chargesTotal + reserveEnergyCost;

    const taxRate = formData.icms + formData.pis + formData.cofins + formData.taxMunicipality;
    const taxes = regulatedSubtotal * taxRate;
    const regulatedTotal = (regulatedSubtotal + taxes) - formData.creditAmount;

    const aclEnergyPeak = (formData.consumptionPeakHours * formData.aclPeakRate) / 1000;
    const aclEnergyOffPeak = (formData.consumptionOffPeakHours * formData.aclOffPeakRate) / 1000;
    const aclEnergy = aclEnergyPeak + aclEnergyOffPeak;

    const aclDemand = (formData.demandPeak * formData.aclDemandPeak) + 
                      (formData.demandOffPeak * formData.aclDemandOffPeak);

    const aclDistribution = (formData.consumptionPeakkWh + formData.consumptionOffPeakkWh) * 0.60;
    const aclSubtotal = aclEnergy + aclDemand + aclDistribution;
    const aclTaxes = aclSubtotal * taxRate;
    const aclTotal = (aclSubtotal + aclTaxes) - formData.creditAmount;

    const monthlyEconomy = regulatedTotal - aclTotal;
    const annualEconomy = monthlyEconomy * 12;
    const economyPercent = regulatedTotal > 0 ? ((monthlyEconomy / regulatedTotal) * 100).toFixed(1) : '0.0';

    setResults({
      regulatedBreakdown: {
        tusdEnergyPeak: tusdEnergyPeak.toFixed(2),
        tusdEnergyOffPeak: tusdEnergyOffPeak.toFixed(2),
        tusdEnergy: tusdEnergy.toFixed(2),
        teEnergyPeak: teEnergyPeak.toFixed(2),
        teEnergyOffPeak: teEnergyOffPeak.toFixed(2),
        teEnergy: teEnergy.toFixed(2),
        bandeira: bandeira.toFixed(2),
        demand: demandCost.toFixed(2),
        charges: chargesTotal.toFixed(2),
        reserveEnergy: reserveEnergyCost.toFixed(2),
        subtotal: regulatedSubtotal.toFixed(2),
        taxes: taxes.toFixed(2),
        credits: formData.creditAmount.toFixed(2),
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

  const renderField = (label: string, fieldName: keyof InvoiceData, type: string = 'number', step: string = '0.01') => (
    <div>
      <label className="text-sm text-slate-400 block mb-1">{label}</label>
      <input
        type={type}
        value={String(formData[fieldName])}
        onChange={(e) => handleChange(fieldName, e.target.value)}
        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:border-blue-500"
        step={step}
      />
    </div>
  );

  const renderSection = (title: string, key: SectionKey, children: React.ReactNode) => (
    <div key={key} className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
      <button
        onClick={() => toggleSection(key)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-700 transition"
      >
        <h3 className="font-bold text-white">{title}</h3>
        {expandedSections[key] ?
          <ChevronUp size={20} className="text-blue-400" /> :
          <ChevronDown size={20} className="text-slate-400" />
        }
      </button>

      {expandedSections[key] && (
        <div className="px-4 py-4 space-y-3 border-t border-slate-700">
          {children}
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-3">
          <FileText size={32} className="text-blue-400" />
          Faturas
        </h1>
        <p className="text-slate-400 mb-8">Registre e calcule faturas de energia com comparativo regulado vs ACL</p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="bg-slate-800 rounded-lg p-6 border border-slate-700 sticky top-6 max-h-96 overflow-y-auto">
              <h2 className="text-xl font-bold text-white mb-4">Registrar Fatura</h2>

              <div className="space-y-4">
                {renderSection('📋 Identificação', 'identification',
                  <div className="space-y-3">
                    {renderField('Número da Fatura', 'invoiceNumber', 'text')}
                    {renderField('UC', 'consumerUnit', 'text')}
                    {renderField('Período', 'referenceMonth', 'month')}
                    {renderField('Contrato', 'contractNumber', 'text')}
                    {renderField('Distribuidora', 'distributor', 'text')}
                  </div>
                )}

                {renderSection('⚡ Consumo', 'consumption',
                  <div className="space-y-3">
                    {renderField('Consumo Ponta (kWh)', 'consumptionPeakkWh')}
                    {renderField('Consumo Fora Ponta (kWh)', 'consumptionOffPeakkWh')}
                  </div>
                )}

                {renderSection('📊 Demanda (kW)', 'demand',
                  <div className="space-y-3">
                    {renderField('Demanda Ponta', 'demandPeak')}
                    {renderField('Demanda Fora Ponta', 'demandOffPeak')}
                  </div>
                )}

                {renderSection('💰 Encargos', 'charges',
                  <div className="space-y-3">
                    {renderField('CCEE (R$/kWh)', 'ccee')}
                    {renderField('ONU (R$/kWh)', 'onu')}
                    {renderField('PES (R$/kWh)', 'pes')}
                    {renderField('RGE (R$/kWh)', 'rge')}
                  </div>
                )}

                {renderSection('🏛️ Impostos', 'taxes',
                  <div className="space-y-3">
                    {renderField('ICMS (%)', 'icms')}
                    {renderField('PIS (%)', 'pis')}
                    {renderField('COFINS (%)', 'cofins')}
                    {renderField('Taxa Municipal (%)', 'taxMunicipality')}
                    {renderField('Crédito (R$)', 'creditAmount')}
                  </div>
                )}

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

          <div className="lg:col-span-2 space-y-6">
            {results && (
              <>
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
                    <p className="text-slate-400 text-sm">% Economia</p>
                    <p className="text-2xl font-bold text-yellow-400">{results.economyPercent}%</p>
                  </div>
                  <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                    <p className="text-slate-400 text-sm">Economia/ano</p>
                    <p className="text-2xl font-bold text-green-500">R$ {results.annualEconomy}</p>
                  </div>
                  <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                    <p className="text-slate-400 text-sm">ROI Anual</p>
                    <p className="text-2xl font-bold text-purple-400">~{(parseFloat(results.economyPercent) * 3).toFixed(0)}%</p>
                  </div>
                </div>

                <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                  <h3 className="text-lg font-bold text-white mb-4">Fatura Regulada - Detalhamento</h3>
                  <div className="space-y-2 text-sm">
                    <div className="bg-slate-700 p-2 rounded">
                      <div className="flex justify-between"><span>TUSD Ponta</span><span>R$ {results.regulatedBreakdown.tusdEnergyPeak}</span></div>
                      <div className="flex justify-between text-slate-400 text-xs"><span>TUSD F.Ponta</span><span>R$ {results.regulatedBreakdown.tusdEnergyOffPeak}</span></div>
                    </div>
                    <div className="bg-slate-700 p-2 rounded">
                      <div className="flex justify-between"><span>TE Ponta</span><span>R$ {results.regulatedBreakdown.teEnergyPeak}</span></div>
                      <div className="flex justify-between text-slate-400 text-xs"><span>TE F.Ponta</span><span>R$ {results.regulatedBreakdown.teEnergyOffPeak}</span></div>
                    </div>
                    <div className="flex justify-between"><span>Bandeira</span><span>R$ {results.regulatedBreakdown.bandeira}</span></div>
                    <div className="flex justify-between"><span>Demanda</span><span>R$ {results.regulatedBreakdown.demand}</span></div>
                    <div className="flex justify-between"><span>Encargos</span><span>R$ {results.regulatedBreakdown.charges}</span></div>
                    <div className="border-t border-slate-600 pt-2 mt-2 flex justify-between font-bold">
                      <span>Subtotal</span><span>R$ {results.regulatedBreakdown.subtotal}</span>
                    </div>
                    <div className="flex justify-between"><span>Impostos</span><span className="text-yellow-400">R$ {results.regulatedBreakdown.taxes}</span></div>
                    <div className="border-t border-slate-600 pt-2 mt-2 flex justify-between font-bold text-lg">
                      <span>TOTAL</span><span className="text-green-400">R$ {results.regulatedTotal}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                  <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <TrendingUp size={24} className="text-green-400" />
                    Comparativo Regulado vs ACL
                  </h3>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div><p className="text-slate-400 text-sm">Regulado</p><p className="text-xl font-bold">R$ {results.regulatedTotal}</p></div>
                    <div><p className="text-slate-400 text-sm">ACL</p><p className="text-xl font-bold text-blue-400">R$ {results.aclTotal}</p></div>
                    <div><p className="text-slate-400 text-sm">Economia</p><p className="text-xl font-bold text-green-400">{results.economyPercent}%</p></div>
                  </div>
                </div>
              </>
            )}

            {!results && (
              <div className="bg-slate-800 rounded-lg p-12 border border-slate-700 text-center">
                <p className="text-slate-400">Preencha os dados e clique em "Calcular Fatura"</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
