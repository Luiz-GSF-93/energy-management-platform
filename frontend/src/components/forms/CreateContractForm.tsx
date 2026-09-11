'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { api } from '@/lib/api/client';
import { Contract } from '@/types/api';
import { ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';

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
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    general: true,
    parties: true,
    energy: true,
    pricing: true,
    adjustments: false,
    flexibility: false,
    commercial: false,
    configuration: true,
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
  } = useForm({
    mode: 'onBlur',
    defaultValues: {
      contractNumber: '',
      contractTitle: '',
      startDate: new Date().toISOString().split('T')[0],
      endDate: '',
      observations: '',
      supplierName: '',
      supplierCnpj: '',
      distributorName: '',
      distributorCnpj: '',
      supplierContact: '',
      supplierEmail: '',
      supplierPhone: '',
      contractedMwhAnnual: 100,
      seasonality: 0,
      flexibility: 10,
      demandKw: 50,
      consumerUnits: '',
      pricePerMwh: 150,
      regulatedPrice: 200,
      tusdComponent: 0,
      icmsPercentage: 18,
      monthlyFee: 1000,
      adjustmentIndex: 'IPCA',
      adjustmentDate: '',
      adjustmentPercentage: 0,
      adjustmentCap: 10,
      adjustmentFloor: -10,
      variationAllowed: 5,
      takeOrPayEnabled: false,
      penaltyPercentage: 5,
      noticeTermDays: 30,
      billingFrequency: 'MONTHLY',
      paymentMethod: 'BOLETO',
      dueCardancyDays: 0,
      currency: 'BRL',
      contractType: 'STANDARD',
      status: 'ACTIVE',
      purchaseModality: 'FREE_MARKET',
      commissionPercentage: 5,
    },
  });

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const onSubmit = async (data: any) => {
    setLoading(true);
    setApiError(null);

    try {
      const response = await api.contracts.create(data);
      
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
      setApiError(errorMsg);
      onError?.(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const SectionHeader = ({ title, section }: { title: string; section: string }) => (
    <button
      type="button"
      onClick={() => toggleSection(section)}
      className="w-full flex items-center justify-between py-3 px-4 bg-gradient-to-r from-slate-700 to-slate-800 hover:from-slate-600 hover:to-slate-700 transition rounded-t-lg"
    >
      <h3 className="font-semibold text-slate-200">{title}</h3>
      {expandedSections[section] ? (
        <ChevronUp size={20} className="text-orange-500" />
      ) : (
        <ChevronDown size={20} className="text-slate-400" />
      )}
    </button>
  );

  const mwhAnnual = Number(watch('contractedMwhAnnual')) || 0;
  const regulatedPrice = Number(watch('regulatedPrice')) || 0;
  const freeMarketPrice = Number(watch('pricePerMwh')) || 0;
  const monthlyFee = Number(watch('monthlyFee')) || 0;

  const economyCalc = mwhAnnual && regulatedPrice && freeMarketPrice
    ? {
        regulatedCost: mwhAnnual * regulatedPrice,
        freeMarketCost: mwhAnnual * freeMarketPrice,
        annualFee: monthlyFee * 12,
      }
    : null;

  const grossSavings = economyCalc
    ? economyCalc.regulatedCost - economyCalc.freeMarketCost
    : 0;

  const netSavings = economyCalc
    ? grossSavings - economyCalc.annualFee
    : 0;

  const savingsPercentage = economyCalc && economyCalc.regulatedCost > 0
    ? (grossSavings / economyCalc.regulatedCost) * 100
    : 0;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 bg-slate-900 p-6 rounded-lg shadow-lg border border-slate-700 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-3xl font-bold text-white">📋 Cadastrar Contrato</h2>
        <span className="text-sm text-slate-400">8 seções</span>
      </div>

      {apiError && (
        <div className="p-4 bg-red-900/50 border border-red-700 text-red-200 rounded-lg flex items-center gap-2">
          <AlertCircle size={20} />
          <span>{apiError}</span>
        </div>
      )}

      {/* ==================== 1. INFORMAÇÕES GERAIS ====================  */}
      <div className="border border-slate-700 rounded-lg overflow-hidden">
        <SectionHeader title="1️⃣ Informações Gerais" section="general" />
        {expandedSections.general && (
          <div className="space-y-4 p-6 bg-slate-800/50">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Nº Contrato *</label>
                <input {...register('contractNumber', { required: 'Obrigatório' })} placeholder="CT-2026-001" className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
                {errors.contractNumber && <span className="text-red-400 text-xs">{errors.contractNumber.message}</span>}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Título *</label>
                <input {...register('contractTitle', { required: 'Obrigatório' })} placeholder="Contrato ML" className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Status *</label>
                <select {...register('status')} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500">
                  <option value="ACTIVE">Ativo</option>
                  <option value="INACTIVE">Inativo</option>
                  <option value="SUSPENDED">Suspenso</option>
                  <option value="TERMINATED">Encerrado</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Data Início *</label>
                <input type="date" {...register('startDate', { required: 'Obrigatório' })} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Data Fim (Vigência)</label>
                <input type="date" {...register('endDate')} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Vigência (meses)</label>
                <input type="number" disabled value={watch('endDate') && watch('startDate') ? Math.round((new Date(watch('endDate')).getTime() - new Date(watch('startDate')).getTime()) / (1000 * 60 * 60 * 24 * 30)) : 0} className="w-full px-3 py-2 bg-slate-600 border border-slate-600 rounded text-white text-sm opacity-50 cursor-not-allowed" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-2">Observações</label>
              <textarea {...register('observations')} placeholder="Notas adicionais..." rows={2} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
          </div>
        )}
      </div>

      {/* ==================== 2. PARTES DO CONTRATO ====================  */}
      <div className="border border-slate-700 rounded-lg overflow-hidden">
        <SectionHeader title="2️⃣ Partes do Contrato (Cliente > Fornecedor > Distribuidor)" section="parties" />
        {expandedSections.parties && (
          <div className="space-y-4 p-6 bg-slate-800/50">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Fornecedor *</label>
                <input {...register('supplierName', { required: 'Obrigatório' })} placeholder="Enel, Cemig..." className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">CNPJ Fornecedor</label>
                <input {...register('supplierCnpj')} placeholder="00.000.000/0000-00" className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Distribuidor</label>
                <input {...register('distributorName')} placeholder="Distribuidor" className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">CNPJ Distribuidor</label>
                <input {...register('distributorCnpj')} placeholder="00.000.000/0000-00" className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Email</label>
                <input type="email" {...register('supplierEmail')} placeholder="email@fornecedor.com.br" className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Telefone</label>
                <input {...register('supplierPhone')} placeholder="(11) 99999-9999" className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-slate-300 mb-2">Contato Fornecedor</label>
                <input {...register('supplierContact')} placeholder="Nome completo" className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ==================== 3. ENERGIA E VOLUME ====================  */}
      <div className="border border-slate-700 rounded-lg overflow-hidden">
        <SectionHeader title="3️⃣ Energia e Volume (MWh + Preço + Vigência)" section="energy" />
        {expandedSections.energy && (
          <div className="space-y-4 p-6 bg-slate-800/50">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">MWh Anual *</label>
                <input type="number" step="0.01" {...register('contractedMwhAnnual', { required: 'Obrigatório', valueAsNumber: true })} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Sazonalidade (%)</label>
                <input type="number" step="0.01" min="0" max="100" {...register('seasonality', { valueAsNumber: true })} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Flexibilidade (%)</label>
                <input type="number" step="0.01" min="0" max="100" {...register('flexibility', { valueAsNumber: true })} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Demanda (kW) *</label>
                <input type="number" step="0.01" {...register('demandKw', { required: 'Obrigatório', valueAsNumber: true })} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-2">Unidades Consumidoras (UCs)</label>
              <textarea {...register('consumerUnits')} placeholder="UC-001, UC-002, UC-003" rows={2} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
          </div>
        )}
      </div>

      {/* ==================== 4. PRECIFICAÇÃO ====================  */}
      <div className="border border-slate-700 rounded-lg overflow-hidden">
        <SectionHeader title="4️⃣ Precificação (Regulado vs Mercado Livre)" section="pricing" />
        {expandedSections.pricing && (
          <div className="space-y-4 p-6 bg-slate-800/50">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Preço ML (R$/MWh) *</label>
                <input type="number" step="0.01" {...register('pricePerMwh', { required: 'Obrigatório', valueAsNumber: true })} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Preço Regulado (R$/MWh) *</label>
                <input type="number" step="0.01" {...register('regulatedPrice', { required: 'Obrigatório', valueAsNumber: true })} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">TUSD (R$/MWh)</label>
                <input type="number" step="0.01" {...register('tusdComponent', { valueAsNumber: true })} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">ICMS (%)</label>
                <input type="number" step="0.01" min="0" max="100" {...register('icmsPercentage', { valueAsNumber: true })} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Taxa Admin (R$/mês) *</label>
                <input type="number" step="0.01" {...register('monthlyFee', { required: 'Obrigatório', valueAsNumber: true })} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Comissão (%)</label>
                <input type="number" step="0.01" min="0" max="100" {...register('commissionPercentage', { valueAsNumber: true })} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>
            </div>

            {grossSavings > 0 && economyCalc && (
              <div className="bg-gradient-to-r from-green-900/30 to-green-900/20 border border-green-700 rounded-lg p-4 mt-4">
                <p className="text-green-300 text-sm font-semibold mb-2">💡 Análise de Economia:</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-green-200">
                  <div>Reg: R$ {economyCalc.regulatedCost.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</div>
                  <div>ML: R$ {economyCalc.freeMarketCost.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</div>
                  <div>Bruta: R$ {grossSavings.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</div>
                  <div>{savingsPercentage.toFixed(1)}% 📈</div>
                  <div className="col-span-2">Fee: R$ {economyCalc.annualFee.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</div>
                  <div className="col-span-2 font-bold">Líquida: R$ {netSavings.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ==================== 5. REAJUSTES ====================  */}
      <div className="border border-slate-700 rounded-lg overflow-hidden">
        <SectionHeader title="5️⃣ Reajustes" section="adjustments" />
        {expandedSections.adjustments && (
          <div className="space-y-4 p-6 bg-slate-800/50">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Índice</label>
                <select {...register('adjustmentIndex')} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500">
                  <option value="IPCA">IPCA</option>
                  <option value="IGP-M">IGP-M</option>
                  <option value="TR">TR</option>
                  <option value="FIXA">Fixa</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">% Anual</label>
                <input type="number" step="0.01" min="0" max="100" {...register('adjustmentPercentage', { valueAsNumber: true })} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Data</label>
                <input type="date" {...register('adjustmentDate')} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Cap (%)</label>
                <input type="number" step="0.01" {...register('adjustmentCap', { valueAsNumber: true })} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Floor (%)</label>
                <input type="number" step="0.01" {...register('adjustmentFloor', { valueAsNumber: true })} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ==================== 6. FLEXIBILIDADE ====================  */}
      <div className="border border-slate-700 rounded-lg overflow-hidden">
        <SectionHeader title="6️⃣ Flexibilidade e Mecanismos" section="flexibility" />
        {expandedSections.flexibility && (
          <div className="space-y-4 p-6 bg-slate-800/50">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Variação (%)</label>
                <input type="number" step="0.01" min="0" max="100" {...register('variationAllowed', { valueAsNumber: true })} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>

              <div className="flex items-end">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" {...register('takeOrPayEnabled')} className="w-4 h-4" />
                  <span className="text-xs font-semibold text-slate-300">Take-or-Pay</span>
                </label>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Penalidade (%)</label>
                <input type="number" step="0.01" min="0" max="100" {...register('penaltyPercentage', { valueAsNumber: true })} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Pré-aviso (dias)</label>
                <input type="number" min="0" {...register('noticeTermDays', { valueAsNumber: true })} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ==================== 7. CONDIÇÕES COMERCIAIS ====================  */}
      <div className="border border-slate-700 rounded-lg overflow-hidden">
        <SectionHeader title="7️⃣ Condições Comerciais" section="commercial" />
        {expandedSections.commercial && (
          <div className="space-y-4 p-6 bg-slate-800/50">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Faturamento</label>
                <select {...register('billingFrequency')} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500">
                  <option value="MONTHLY">Mensal</option>
                  <option value="ANNUAL">Anual</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Pagamento</label>
                <select {...register('paymentMethod')} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500">
                  <option value="BOLETO">Boleto</option>
                  <option value="TED">TED</option>
                  <option value="PIX">PIX</option>
                  <option value="FATURA">Fatura</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Moeda</label>
                <select {...register('currency')} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500">
                  <option value="BRL">BRL</option>
                  <option value="USD">USD</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Dias Carência</label>
                <input type="number" min="0" {...register('dueCardancyDays', { valueAsNumber: true })} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ==================== 8. CONFIGURAÇÃO ====================  */}
      <div className="border border-slate-700 rounded-lg overflow-hidden">
        <SectionHeader title="8️⃣ Configuração" section="configuration" />
        {expandedSections.configuration && (
          <div className="space-y-4 p-6 bg-slate-800/50">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Tipo *</label>
                <select {...register('contractType')} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500">
                  <option value="STANDARD">Padrão</option>
                  <option value="PREFERENCIAL">Preferencial</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Modalidade *</label>
                <select {...register('purchaseModality')} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500">
                  <option value="FREE_MARKET">Mercado Livre</option>
                  <option value="BILATERAL">Bilateral</option>
                  <option value="CONVENTIONAL">Convencional</option>
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* BOTÕES */}
      <div className="flex gap-4 pt-6">
        <button type="submit" disabled={loading} className="flex-1 bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-700 hover:to-orange-800 text-white py-3 px-4 rounded font-semibold disabled:opacity-50 transition">
          {loading ? '⏳ Salvando...' : '✓ Cadastrar Contrato'}
        </button>
        <button type="button" onClick={() => reset()} className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-200 py-3 px-4 rounded font-semibold transition">
          🔄 Limpar
        </button>
      </div>
    </form>
  );
}
