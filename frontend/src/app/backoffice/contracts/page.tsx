'use client';

import { useState } from 'react';
import { FileText, Save, ChevronDown, ChevronUp } from 'lucide-react';

interface ContractData {
  contractNumber: string;
  clientName: string;
  cnpj: string;
  distributor: string;
  consumerUnits: string;
  modalidade: 'AZUL' | 'VERDE' | 'BRANCA';
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
  acePeakRate: number;
  aceOffPeakRate: number;
  aclDistributionPeak: number;
  aclDistributionOffPeak: number;
  aclDemandPeak: number;
  aclDemandOffPeak: number;
  icms: number;
  pis: number;
  cofins: number;
  taxMunicipality: number;
  creditRate: number;
  technicalLoss: number;
}

type SectionKey = 'identification' | 'tusd' | 'te' | 'acl' | 'taxes';

interface ExpandedSections {
  identification: boolean;
  tusd: boolean;
  te: boolean;
  acl: boolean;
  taxes: boolean;
}

const initialData: ContractData = {
  contractNumber: 'CT-2026-001',
  clientName: 'Empresa XYZ LTDA',
  cnpj: '12.345.678/0001-99',
  distributor: 'CPFL Energia',
  consumerUnits: '5',
  modalidade: 'AZUL',
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
  acePeakRate: 120.00,
  aceOffPeakRate: 80.00,
  aclDistributionPeak: 0.75,
  aclDistributionOffPeak: 0.45,
  aclDemandPeak: 22.00,
  aclDemandOffPeak: 12.00,
  icms: 0.18,
  pis: 0.0765,
  cofins: 0.076,
  taxMunicipality: 0.05,
  creditRate: 0.90,
  technicalLoss: 0.03,
};

interface FieldConfig {
  name: keyof ContractData;
  label: string;
  type?: string;
  placeholder?: string;
  step?: string;
}

export default function ContractsPage() {
  const [formData, setFormData] = useState<ContractData>(initialData);
  const [expandedSections, setExpandedSections] = useState<ExpandedSections>({
    identification: true,
    tusd: true,
    te: true,
    acl: false,
    taxes: false,
  });

  const toggleSection = (section: SectionKey) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const handleChange = (field: keyof ContractData, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: isNaN(value) ? value : parseFloat(value) || 0
    }));
  };

  const renderSection = (title: string, key: SectionKey, fields: FieldConfig[]) => (
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
          {fields.map((field) => (
            <div key={String(field.name)}>
              <label className="text-sm text-slate-400 block mb-1">{field.label}</label>
              <input
                type={field.type || 'text'}
                placeholder={field.placeholder}
                value={String(formData[field.name])}
                onChange={(e) => handleChange(field.name, e.target.value)}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:border-blue-500"
                step={field.step}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const sections = [
    {
      title: '📋 Identificação do Contrato',
      key: 'identification' as SectionKey,
      fields: [
        { name: 'contractNumber' as const, label: 'Número do Contrato', type: 'text', placeholder: 'CT-2026-001' },
        { name: 'clientName' as const, label: 'Nome do Cliente', type: 'text', placeholder: 'Empresa XYZ LTDA' },
        { name: 'cnpj' as const, label: 'CNPJ', type: 'text', placeholder: '12.345.678/0001-99' },
        { name: 'distributor' as const, label: 'Distribuidora', type: 'text', placeholder: 'CPFL Energia' },
        { name: 'consumerUnits' as const, label: 'Quantidade de UCs', type: 'number', placeholder: '5' },
        { name: 'modalidade' as const, label: 'Modalidade', type: 'text', placeholder: 'AZUL' },
      ] as FieldConfig[]
    },
    {
      title: '⚡ TUSD - Tarifa de Uso do Sistema de Distribuição',
      key: 'tusd' as SectionKey,
      fields: [
        { name: 'tusdPeakRate' as const, label: 'TUSD Ponta (R$/kWh)', type: 'number', step: '0.01' },
        { name: 'tusdOffPeakRate' as const, label: 'TUSD Fora Ponta (R$/kWh)', type: 'number', step: '0.01' },
        { name: 'tusdDemandPeak' as const, label: 'Demanda Ponta (R$/kW)', type: 'number', step: '0.01' },
        { name: 'tusdDemandOffPeak' as const, label: 'Demanda Fora Ponta (R$/kW)', type: 'number', step: '0.01' },
      ] as FieldConfig[]
    },
    {
      title: '🔌 TE - Tarifa de Energia',
      key: 'te' as SectionKey,
      fields: [
        { name: 'tePeakRate' as const, label: 'TE Ponta (R$/MWh)', type: 'number', step: '0.01' },
        { name: 'teOffPeakRate' as const, label: 'TE Fora Ponta (R$/MWh)', type: 'number', step: '0.01' },
        { name: 'bandeiraPeak' as const, label: 'Bandeira Ponta (R$/kWh)', type: 'number', step: '0.01' },
        { name: 'bandeiraOffPeak' as const, label: 'Bandeira Fora Ponta (R$/kWh)', type: 'number', step: '0.01' },
        { name: 'ccee' as const, label: 'CCEE (R$/kWh)', type: 'number', step: '0.01' },
        { name: 'onu' as const, label: 'ONU (R$/kWh)', type: 'number', step: '0.01' },
        { name: 'pes' as const, label: 'PES (R$/kWh)', type: 'number', step: '0.01' },
        { name: 'rge' as const, label: 'RGE (R$/kWh)', type: 'number', step: '0.01' },
      ] as FieldConfig[]
    },
    {
      title: '🟢 ACL - Mercado Livre',
      key: 'acl' as SectionKey,
      fields: [
        { name: 'acePeakRate' as const, label: 'ACE Ponta (R$/MWh)', type: 'number', step: '0.01' },
        { name: 'aceOffPeakRate' as const, label: 'ACE Fora Ponta (R$/MWh)', type: 'number', step: '0.01' },
        { name: 'aclDistributionPeak' as const, label: 'Distribuição Ponta (R$/kWh)', type: 'number', step: '0.01' },
        { name: 'aclDistributionOffPeak' as const, label: 'Distribuição Fora Ponta (R$/kWh)', type: 'number', step: '0.01' },
        { name: 'aclDemandPeak' as const, label: 'Demanda Ponta (R$/kW)', type: 'number', step: '0.01' },
        { name: 'aclDemandOffPeak' as const, label: 'Demanda Fora Ponta (R$/kW)', type: 'number', step: '0.01' },
      ] as FieldConfig[]
    },
    {
      title: '💰 Impostos e Taxas',
      key: 'taxes' as SectionKey,
      fields: [
        { name: 'icms' as const, label: 'ICMS (%)', type: 'number', step: '0.01' },
        { name: 'pis' as const, label: 'PIS (%)', type: 'number', step: '0.01' },
        { name: 'cofins' as const, label: 'COFINS (%)', type: 'number', step: '0.01' },
        { name: 'taxMunicipality' as const, label: 'Taxa Municipal (%)', type: 'number', step: '0.01' },
        { name: 'creditRate' as const, label: 'Taxa de Crédito (%)', type: 'number', step: '0.01' },
        { name: 'technicalLoss' as const, label: 'Perda Técnica (%)', type: 'number', step: '0.01' },
      ] as FieldConfig[]
    }
  ];

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-3">
          <FileText size={32} className="text-blue-400" />
          Contratos
        </h1>
        <p className="text-slate-400 mb-8">Cadastre todos os dados de tarifa para simulação</p>

        <div className="space-y-4">
          {sections.map((section) => renderSection(section.title, section.key, section.fields))}

          <div className="flex gap-4 mt-8">
            <button className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded flex items-center justify-center gap-2">
              <Save size={20} />
              Salvar Contrato
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
