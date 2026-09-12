'use client';

import { useState } from 'react';
import { FileText, Save, ChevronDown, ChevronUp } from 'lucide-react';

interface ContractData {
  // IDENTIFICAÇÃO
  contractNumber: string;
  clientName: string;
  cnpj: string;
  distributor: string;
  
  // UNIDADES CONSUMIDORAS
  consumerUnits: string;
  modalidade: 'AZUL' | 'VERDE' | 'BRANCA';
  
  // TUSD - TARIFA DE USO DO SISTEMA DE DISTRIBUIÇÃO
  tusdPeakRate: number;
  tusdOffPeakRate: number;
  tusdDemandPeak: number;
  tusdDemandOffPeak: number;
  
  // TE - TARIFA DE ENERGIA
  tePeakRate: number;
  teOffPeakRate: number;
  
  // ENCARGOS SETORIAIS
  bandeiraPeak: number;
  bandeiraOffPeak: number;
  ccee: number;
  onu: number;
  pes: number;
  rge: number;
  
  // MERCADO LIVRE - ACL
  acePeakRate: number;
  aceOffPeakRate: number;
  aclDistributionPeak: number;
  aclDistributionOffPeak: number;
  aclDemandPeak: number;
  aclDemandOffPeak: number;
  
  // IMPOSTOS
  icms: number;
  pis: number;
  cofins: number;
  
  // TAXAS MUNICIPAIS
  taxMunicipality: number;
  
  // CRÉDITO DE ENERGIA (para geração própria)
  creditRate: number;
  
  // PERDAS TÉCNICAS
  technicalLoss: number;
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

export default function ContractsPage() {
  const [formData, setFormData] = useState<ContractData>(initialData);
  const [expandedSections, setExpandedSections] = useState({
    identification: true,
    tusd: true,
    te: true,
    acl: false,
    taxes: false,
  });

  const toggleSection = (section: string) => {
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

  const renderSection = (title: string, key: string, fields: any[]) => (
    <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
      <button
        onClick={() => toggleSection(key)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-700 transition"
      >
        <h3 className="font-bold text-white">{title}</h3>
        {expandedSections[key as keyof typeof expandedSections] ? 
          <ChevronUp size={20} className="text-blue-400" /> : 
          <ChevronDown size={20} className="text-slate-400" />
        }
      </button>
      
      {expandedSections[key as keyof typeof expandedSections] && (
        <div className="px-4 py-4 space-y-3 border-t border-slate-700">
          {fields.map((field) => (
            <div key={field.name}>
              <label className="text-sm text-slate-400 block mb-1">{field.label}</label>
              <input
                type={field.type || 'text'}
                placeholder={field.placeholder}
                value={formData[field.name as keyof ContractData]}
                onChange={(e) => handleChange(field.name as keyof ContractData, e.target.value)}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:border-blue-500"
                step={field.step || undefined}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-3">
          <FileText size={32} className="text-blue-400" />
          Contratos
        </h1>
        <p className="text-slate-400 mb-8">Cadastre todos os dados de tarifa e estrutura tarifária para simulação</p>

        <div className="space-y-4">
          {/* IDENTIFICAÇÃO */}
          {renderSection('📋 Identificação do Contrato', 'identification', [
            { name: 'contractNumber', label: 'Número do Contrato', type: 'text', placeholder: 'CT-2026-001' },
            { name: 'clientName', label: 'Nome do Cliente', type: 'text', placeholder: 'Empresa XYZ LTDA' },
            { name: 'cnpj', label: 'CNPJ', type: 'text', placeholder: '12.345.678/0001-99' },
            { name: 'distributor', label: 'Distribuidora', type: 'text', placeholder: 'CPFL Energia' },
            { name: 'consumerUnits', label: 'Quantidade de UCs', type: 'number', placeholder: '5' },
            { name: 'modalidade', label: 'Modalidade', type: 'select', options: ['AZUL', 'VERDE', 'BRANCA'] },
          ])}

          {/* TUSD */}
          {renderSection('⚡ TUSD - Tarifa de Uso do Sistema de Distribuição (R$/kWh)', 'tusd', [
            { name: 'tusdPeakRate', label: 'TUSD Ponta', type: 'number', step: '0.01' },
            { name: 'tusdOffPeakRate', label: 'TUSD Fora Ponta', type: 'number', step: '0.01' },
            { name: 'tusdDemandPeak', label: 'Demanda Ponta (R$/kW)', type: 'number', step: '0.01' },
            { name: 'tusdDemandOffPeak', label: 'Demanda Fora Ponta (R$/kW)', type: 'number', step: '0.01' },
          ])}

          {/* TE */}
          {renderSection('🔌 TE - Tarifa de Energia (R$/MWh)', 'te', [
            { name: 'tePeakRate', label: 'TE Ponta', type: 'number', step: '0.01' },
            { name: 'teOffPeakRate', label: 'TE Fora Ponta', type: 'number', step: '0.01' },
            { name: 'bandeiraPeak', label: 'Bandeira Ponta (R$/kWh)', type: 'number', step: '0.01' },
            { name: 'bandeiraOffPeak', label: 'Bandeira Fora Ponta (R$/kWh)', type: 'number', step: '0.01' },
            { name: 'ccee', label: 'CCEE (R$/kWh)', type: 'number', step: '0.01' },
            { name: 'onu', label: 'ONU (R$/kWh)', type: 'number', step: '0.01' },
            { name: 'pes', label: 'PES (R$/kWh)', type: 'number', step: '0.01' },
            { name: 'rge', label: 'RGE (R$/kWh)', type: 'number', step: '0.01' },
          ])}

          {/* ACL */}
          {renderSection('🟢 ACL - Ambiente de Contratação Livre (Mercado Livre)', 'acl', [
            { name: 'acePeakRate', label: 'ACE Ponta (R$/MWh)', type: 'number', step: '0.01' },
            { name: 'aceOffPeakRate', label: 'ACE Fora Ponta (R$/MWh)', type: 'number', step: '0.01' },
            { name: 'aclDistributionPeak', label: 'Distribuição ACL Ponta (R$/kWh)', type: 'number', step: '0.01' },
            { name: 'aclDistributionOffPeak', label: 'Distribuição ACL Fora Ponta (R$/kWh)', type: 'number', step: '0.01' },
            { name: 'aclDemandPeak', label: 'Demanda ACL Ponta (R$/kW)', type: 'number', step: '0.01' },
            { name: 'aclDemandOffPeak', label: 'Demanda ACL Fora Ponta (R$/kW)', type: 'number', step: '0.01' },
          ])}

          {/* IMPOSTOS */}
          {renderSection('💰 Impostos e Taxas', 'taxes', [
            { name: 'icms', label: 'ICMS (%)', type: 'number', step: '0.01' },
            { name: 'pis', label: 'PIS (%)', type: 'number', step: '0.01' },
            { name: 'cofins', label: 'COFINS (%)', type: 'number', step: '0.01' },
            { name: 'taxMunicipality', label: 'Taxa Municipal (%)', type: 'number', step: '0.01' },
            { name: 'creditRate', label: 'Taxa de Crédito (%)', type: 'number', step: '0.01' },
            { name: 'technicalLoss', label: 'Perda Técnica (%)', type: 'number', step: '0.01' },
          ])}

          {/* BOTÕES */}
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
