'use client';

import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { api } from '@/lib/api/client';
import { Contract } from '@/types/api';
import { TariffConfig } from '@/types/tariff';
import { ChevronDown, ChevronUp, AlertCircle, Plus } from 'lucide-react';
import { DistributorModal } from '@/components/modals/DistributorModal';
import { TariffConfigForm } from '@/components/forms/TariffConfigForm';

interface Distributor {
  id: string;
  name: string;
  cnpj: string;
}

interface CreateContractFormProps {
  onSuccess?: (contract: Contract) => void;
  onError?: (error: string) => void;
}

// Motor de Cálculo
const calculateContractMetrics = (data: any) => {
  const mwhAnnual = Number(data.contractedMwhAnnual) || 0;
  const regulatedPrice = Number(data.regulatedPrice) || 0;
  const freeMarketPrice = Number(data.pricePerMwh) || 0;
  const monthlyFee = Number(data.monthlyFee) || 0;
  const tusdComponent = Number(data.tusdComponent) || 0;
  const icmsRate = Number(data.icmsPercentage) || 0;
  const demandKw = Number(data.demandKw) || 0;

  const regulatedCostBase = mwhAnnual * regulatedPrice;
  const freeMarketCostBase = mwhAnnual * freeMarketPrice;
  const tusdCost = mwhAnnual * tusdComponent;

  const icmsValueRegulated = regulatedCostBase * (icmsRate / 100);
  const icmsValueFreeMarket = (freeMarketCostBase + tusdCost) * (icmsRate / 100);

  const regulatedTotal = regulatedCostBase + icmsValueRegulated;
  const freeMarketTotal = freeMarketCostBase + tusdCost + icmsValueFreeMarket;

  const annualFee = monthlyFee * 12;

  const grossSavings = regulatedTotal - freeMarketTotal;
  const netSavings = grossSavings - annualFee;
  const savingsPercentage = regulatedTotal > 0 ? (grossSavings / regulatedTotal) * 100 : 0;

  const roi = annualFee > 0 ? (netSavings / annualFee) * 100 : 0;

  return {
    regulatedCostBase,
    freeMarketCostBase,
    tusdCost,
    icmsValueRegulated,
    icmsValueFreeMarket,
    regulatedTotal,
    freeMarketTotal,
    annualFee,
    grossSavings,
    netSavings,
    savingsPercentage,
    roi,
    demandKw,
    mwhAnnual,
  };
};

export function CreateContractForm({
  onSuccess,
  onError,
}: CreateContractFormProps) {
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [distributorModalOpen, setDistributorModalOpen] = useState(false);
  const [distributors, setDistributors] = useState<Distributor[]>([
    { id: '1', name: 'CPFL', cnpj: '13.813.096/0001-55' },
    { id: '2', name: 'Enel', cnpj: '00.360.305/0001-04' },
    { id: '3', name: 'Cemig', cnpj: '17.314.873/0001-02' },
  ]);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    general: true,
    client: true,
    parties: true,
    energy: true,
    pricing: true,
    tariff: true,
    adjustments: false,
    flexibility: false,
    commercial: false,
    configuration: true,
  });

  const [tariffConfig, setTariffConfig] = useState<TariffConfig | null>(null);
  const [calculationResult, setCalculationResult] = useState<any>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
    setValue,
  } = useForm({
    mode: 'onBlur',
    defaultValues: {
      clientName: '',
      clientCnpj: '',
      clientEmail: '',
      clientPhone: '',
      clientAddress: '',
      clientCity: '',
      clientState: '',

      contractNumber: '',
      contractTitle: '',
      startDate: new Date().toISOString().split('T')[0],
      endDate: '',
      observations: '',

      supplierName: '',
      supplierCnpj: '',
      supplierContact: '',
      supplierEmail: '',
      supplierPhone: '',

      distributorName: '',
      distributorCnpj: '',

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
      commissionPercentage: 5,

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
    },
  });

  const watchedFields = watch([
    'contractedMwhAnnual',
    'regulatedPrice',
    'pricePerMwh',
    'monthlyFee',
    'tusdComponent',
    'icmsPercentage',
    'demandKw',
  ]);

  const metrics = useMemo(() => {
    return calculateContractMetrics({
      contractedMwhAnnual: watchedFields[0],
      regulatedPrice: watchedFields[1],
      pricePerMwh: watchedFields[2],
      monthlyFee: watchedFields[3],
      tusdComponent: watchedFields[4],
      icmsPercentage: watchedFields[5],
      demandKw: watchedFields[6],
    });
  }, [watchedFields]);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const handleAddDistributor = (distributor: Distributor) => {
    setDistributors([...distributors, distributor]);
  };

  const handleDeleteDistributor = (id: string) => {
    setDistributors(distributors.filter(d => d.id !== id));
  };

  const handleSelectDistributor = (distributor: Distributor) => {
    setValue('distributorName', distributor.name);
    setValue('distributorCnpj', distributor.cnpj);
  };

  const handleTariffConfigSave = (config: TariffConfig) => {
    setTariffConfig(config);
    alert('✅ Configuração de tarifas salva com sucesso!');
  };

  const handleTariffCalculate = async (config: TariffConfig) => {
    try {
      // Simular cálculo com a tarifa configurada
      const consumptionData = {
        consumptionPeakKwh: 600,
        consumptionOffPeakKwh: 600,
        demandPeakKw: 50,
        demandOffPeakKw: 40,
        generatorVolumeMwh: watch('contractedMwhAnnual'),
      };

      // Preparar input para o backend
      const settlementInput = {
        consumerUnitId: 'uc-temp',
        referenceMonth: new Date(),
        regulatedTusd: {
          consumptionPeakKwh: consumptionData.consumptionPeakKwh,
          consumptionOffPeakKwh: consumptionData.consumptionOffPeakKwh,
          demandPeakKw: consumptionData.demandPeakKw,
          demandOffPeakKw: consumptionData.demandOffPeakKw,
          tusdRatePeak: config.regulated.tusd.peakRate,
          tusdRateOffPeak: config.regulated.tusd.offPeakRate,
          demandRate: config.regulated.tusd.demandRate,
        },
        regulatedTe: {
          consumptionPeakKwh: consumptionData.consumptionPeakKwh,
          consumptionOffPeakKwh: consumptionData.consumptionOffPeakKwh,
          teRatePeak: config.regulated.te.peakRate,
          teRateOffPeak: config.regulated.te.offPeakRate,
          additionalBandPeak: config.regulated.additionalCharges?.bandeiraPeak,
          additionalBandOffPeak: config.regulated.additionalCharges?.bandeiraOffPeak,
        },
        aclDistribution: {
          consumptionPeakTusdKwh: consumptionData.consumptionPeakKwh,
          consumptionOffPeakTusdKwh: consumptionData.consumptionOffPeakKwh,
          demandPeakKw: consumptionData.demandPeakKw,
          demandOffPeakKw: consumptionData.demandOffPeakKw,
          tusdRatePeak: config.acl.distribution.tusdPeakRate,
          tusdRateOffPeak: config.acl.distribution.tusdOffPeakRate,
          demandRate: config.acl.distribution.demandRate,
          cdeCovid: config.acl.distribution.cdeCovid,
          cdeWater: config.acl.distribution.cdeWater,
        },
        aclCcee: {
          generatorVolumeMwh: consumptionData.generatorVolumeMwh,
          generatorRateMwhBrl: config.acl.generator.ratePerMwh,
          contributionAssociative: config.acl.ccee.associativeContribution,
          eer: config.acl.ccee.eer,
          ercap: config.acl.ccee.ercap,
          financialGuarantee: config.acl.ccee.financialGuarantee,
          penalties: config.acl.ccee.penalties,
          liquidationMcpCredit: config.acl.ccee.liquidationMcp,
          nuclearQuotas: config.acl.ccee.nuclearQuotas,
        },
        taxes: {
          pisFederal: config.taxes.pisFederal,
          cofinsFederal: config.taxes.cofinsFederal,
          icmsStateRate: config.taxes.icmsState,
        },
      };

      const response = await api.settlements.calculate(settlementInput);
      
      if (response.data) {
        setCalculationResult(response.data);
        alert('✅ Cálculo realizado com sucesso!');
      }
    } catch (err: any) {
      alert(`❌ Erro ao calcular: ${err.message}`);
    }
  };

  const onSubmit = async (data: any) => {
    setLoading(true);
    setApiError(null);

    try {
      const contractData = {
        ...data,
        tariffConfig,
        calculationResult,
      };

      const response = await api.contracts.create(contractData);

      if (response.statusCode === 201 && response.data) {
        onSuccess?.(response.data as Contract);
        reset();
        setTariffConfig(null);
        setCalculationResult(null);
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

  return (
    <>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 bg-slate-900 p-6 rounded-lg shadow-lg border border-slate-700 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-3xl font-bold text-white">📝 Cadastrar Contrato</h2>
          <span className="text-sm text-slate-400">10 seções</span>
        </div>

        {apiError && (
          <div className="p-4 bg-red-900/50 border border-red-700 text-red-200 rounded-lg flex items-center gap-2">
            <AlertCircle size={20} />
            <span>{apiError}</span>
          </div>
        )}

        {/* 1. INFORMAÇÕES GERAIS */}
        <div className="border border-slate-700 rounded-lg overflow-hidden">
          <SectionHeader title="1️⃣ Informações Gerais" section="general" />
          {expandedSections.general && (
            <div className="space-y-4 p-6 bg-slate-800/50">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Observações</label>
                <textarea {...register('observations')} placeholder="Notas adicionais..." rows={2} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>
            </div>
          )}
        </div>

        {/* 2. DADOS DO CLIENTE */}
        <div className="border border-slate-700 rounded-lg overflow-hidden">
          <SectionHeader title="2️⃣ Dados do Cliente" section="client" />
          {expandedSections.client && (
            <div className="space-y-4 p-6 bg-slate-800/50">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-2">Razão Social *</label>
                  <input {...register('clientName', { required: 'Obrigatório' })} placeholder="Empresa LTDA" className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-2">CNPJ *</label>
                  <input {...register('clientCnpj', { required: 'Obrigatório' })} placeholder="00.000.000/0001-00" className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-2">Email</label>
                  <input type="email" {...register('clientEmail')} placeholder="contato@empresa.com.br" className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-2">Telefone</label>
                  <input {...register('clientPhone')} placeholder="(11) 99999-9999" className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-300 mb-2">Endereço</label>
                  <input {...register('clientAddress')} placeholder="Rua, número" className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-2">Cidade</label>
                  <input {...register('clientCity')} placeholder="São Paulo" className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-2">Estado</label>
                  <input {...register('clientState')} placeholder="SP" maxLength={2} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 3. PARTES DO CONTRATO */}
        <div className="border border-slate-700 rounded-lg overflow-hidden">
          <SectionHeader title="3️⃣ Partes do Contrato (Cliente > Fornecedor > Distribuidor)" section="parties" />
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
                  <label className="block text-xs font-semibold text-slate-300 mb-2">Contato Fornecedor</label>
                  <input {...register('supplierContact')} placeholder="Nome completo" className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-2">Email</label>
                  <input type="email" {...register('supplierEmail')} placeholder="email@fornecedor.com.br" className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-2">Telefone</label>
                  <input {...register('supplierPhone')} placeholder="(11) 99999-9999" className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
                </div>
              </div>

              <div className="border-t border-slate-700 pt-4 mt-4">
                <div className="flex justify-between items-center mb-4">
                  <h4 className="font-semibold text-slate-200">Distribuidor</h4>
                  <button
                    type="button"
                    onClick={() => setDistributorModalOpen(true)}
                    className="px-3 py-1 bg-orange-600 hover:bg-orange-700 text-white text-xs rounded flex items-center gap-1 transition"
                  >
                    <Plus size={16} /> Gerenciar
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-2">Distribuidor</label>
                    <input {...register('distributorName')} placeholder="Distribuidor" className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-2">CNPJ Distribuidor</label>
                    <input {...register('distributorCnpj')} placeholder="00.000.000/0000-00" className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 4. ENERGIA E VOLUME */}
        <div className="border border-slate-700 rounded-lg overflow-hidden">
          <SectionHeader title="4️⃣ Energia e Volume (MWh + Preço + Vigência)" section="energy" />
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

        {/* 5. PRECIFICAÇÃO */}
        <div className="border border-slate-700 rounded-lg overflow-hidden">
          <SectionHeader title="5️⃣ Precificação (Regulado vs Mercado Livre)" section="pricing" />
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

              {metrics.regulatedTotal > 0 && (
                <div className="bg-gradient-to-r from-green-900/40 to-blue-900/40 border border-green-700 rounded-lg p-4 mt-4 space-y-3">
                  <p className="text-green-300 text-sm font-semibold">📊 Análise Comparativa (Anual):</p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="bg-slate-800/50 p-3 rounded border border-slate-700">
                      <p className="text-xs text-slate-400 mb-1">Mercado Regulado</p>
                      <p className="text-xs text-slate-300">Energia: R$ {metrics.regulatedCostBase.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</p>
                      <p className="text-xs text-slate-300">ICMS: R$ {metrics.icmsValueRegulated.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</p>
                      <p className="text-lg font-bold text-red-400">Total: R$ {metrics.regulatedTotal.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</p>
                    </div>

                    <div className="bg-slate-800/50 p-3 rounded border border-slate-700">
                      <p className="text-xs text-slate-400 mb-1">Mercado Livre</p>
                      <p className="text-xs text-slate-300">Energia: R$ {metrics.freeMarketCostBase.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</p>
                      <p className="text-xs text-slate-300">TUSD+ICMS: R$ {(metrics.tusdCost + metrics.icmsValueFreeMarket).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</p>
                      <p className="text-lg font-bold text-blue-400">Total: R$ {metrics.freeMarketTotal.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 border-t border-slate-700 pt-3">
                    <div className="bg-green-900/30 p-3 rounded">
                      <p className="text-xs text-green-300">Economia Bruta</p>
                      <p className="text-xl font-bold text-green-400">R$ {metrics.grossSavings.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</p>
                      <p className="text-xs text-green-300">{metrics.savingsPercentage.toFixed(1)}%</p>
                    </div>
                    <div className="bg-orange-900/30 p-3 rounded">
                      <p className="text-xs text-orange-300">Taxa Anual</p>
                      <p className="text-xl font-bold text-orange-400">R$ {metrics.annualFee.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</p>
                    </div>
                    <div className={`p-3 rounded ${metrics.netSavings > 0 ? 'bg-green-900/30' : 'bg-red-900/30'}`}>
                      <p className={`text-xs ${metrics.netSavings > 0 ? 'text-green-300' : 'text-red-300'}`}>Economia Líquida (ROI)</p>
                      <p className={`text-xl font-bold ${metrics.netSavings > 0 ? 'text-green-400' : 'text-red-400'}`}>R$ {metrics.netSavings.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</p>
                      <p className={`text-xs ${metrics.netSavings > 0 ? 'text-green-300' : 'text-red-300'}`}>{metrics.roi.toFixed(1)}%</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 6. CONFIGURAÇÃO DE TARIFAS */}
        <div className="border border-slate-700 rounded-lg overflow-hidden">
          <SectionHeader title="6️⃣ Configuração de Tarifas (Detalhado)" section="tariff" />
          {expandedSections.tariff && (
            <div className="p-6 bg-slate-800/50">
              <TariffConfigForm
                initialData={tariffConfig || undefined}
                onSubmit={handleTariffConfigSave}
                onCalculate={handleTariffCalculate}
              />
              {calculationResult && (
                <div className="mt-4 p-4 bg-green-900/20 border border-green-700 rounded-lg">
                  <h4 className="text-green-300 font-semibold mb-2">✅ Resultado do Cálculo com Tarifas Detalhadas:</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-slate-300">
                    <div>Regulado: R$ {calculationResult.regulatedTotalCost?.toLocaleString('pt-BR')}</div>
                    <div>ACL: R$ {calculationResult.aclTotalCost?.toLocaleString('pt-BR')}</div>
                    <div>Economia: R$ {calculationResult.grossSavings?.toLocaleString('pt-BR')} ({calculationResult.savingsPercentage?.toFixed(1)}%)</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 7. REAJUSTES */}
        <div className="border border-slate-700 rounded-lg overflow-hidden">
          <SectionHeader title="7️⃣ Reajustes" section="adjustments" />
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
              </div>
            </div>
          )}
        </div>

        {/* 8. FLEXIBILIDADE */}
        <div className="border border-slate-700 rounded-lg overflow-hidden">
          <SectionHeader title="8️⃣ Flexibilidade e Mecanismos" section="flexibility" />
          {expandedSections.flexibility && (
            <div className="space-y-4 p-6 bg-slate-800/50">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-2">Variação (%)</label>
                  <input type="number" step="0.01" min="0" max="100" {...register('variationAllowed', { valueAsNumber: true })} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-2">Penalidade (%)</label>
                  <input type="number" step="0.01" min="0" max="100" {...register('penaltyPercentage', { valueAsNumber: true })} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
                </div>
                <div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" {...register('takeOrPayEnabled')} className="w-4 h-4" />
                    <span className="text-xs font-semibold text-slate-300">Take-or-Pay</span>
                  </label>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-2">Pré-aviso (dias)</label>
                  <input type="number" min="0" {...register('noticeTermDays', { valueAsNumber: true })} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 9. CONDIÇÕES COMERCIAIS */}
        <div className="border border-slate-700 rounded-lg overflow-hidden">
          <SectionHeader title="9️⃣ Condições Comerciais" section="commercial" />
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
                  <label className="block text-xs font-semibold text-slate-300 mb-2">Dias Carência</label>
                  <input type="number" min="0" {...register('dueCardancyDays', { valueAsNumber: true })} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 10. CONFIGURAÇÃO */}
        <div className="border border-slate-700 rounded-lg overflow-hidden">
          <SectionHeader title="🔟 Configuração" section="configuration" />
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
            {loading ? '⏳ Salvando...' : '✅ Cadastrar Contrato'}
          </button>
          <button type="button" onClick={() => reset()} className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-200 py-3 px-4 rounded font-semibold transition">
            🔄 Limpar
          </button>
        </div>
      </form>

      {/* Modal de Distribuidor */}
      <DistributorModal
        isOpen={distributorModalOpen}
        onClose={() => setDistributorModalOpen(false)}
        distributors={distributors}
        onAddDistributor={handleAddDistributor}
        onDeleteDistributor={handleDeleteDistributor}
        onSelectDistributor={handleSelectDistributor}
      />
    </>
  );
}
