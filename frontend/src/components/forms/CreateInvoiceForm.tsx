'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { api } from '@/lib/api/client';
import { Invoice } from '@/types/invoice';
import { ChevronDown, ChevronUp, Loader } from 'lucide-react';

interface CreateInvoiceFormProps {
  consumerUnitId: string;
  contractId: string;
  onSuccess?: (invoice: Invoice) => void;
  onError?: (error: string) => void;
}

export function CreateInvoiceForm({
  consumerUnitId,
  contractId,
  onSuccess,
  onError,
}: CreateInvoiceFormProps) {
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string>('identification');
  const [economyCalc, setEconomyCalc] = useState({
    regulatedCost: 0,
    freeMarketCost: 0,
    savings: 0,
    savingsPercentage: 0,
  });

  const { register, handleSubmit, watch, reset, formState: { errors } } = useForm<any>({
    defaultValues: {
      invoiceNumber: '',
      referenceMonth: new Date().toISOString().split('T')[0],
      distributorName: '',
      distributorCnpj: '',
      consumerUnitNumber: '',
      meterNumber: '',
      tariffModality: 'conventional',
      consumptionKwhPeak: 0,
      consumptionKwhOffPeak: 0,
      totalConsumptionKwh: 0,
      demandKwPeak: 0,
      demandKwOffPeak: 0,
      demandKwBilled: 0,
      tusdEnergyRatePeak: 0,
      tusdEnergyRateOffPeak: 0,
      teEnergyRatePeak: 0,
      teEnergyRateOffPeak: 0,
      demandRatePeak: 0,
      demandRateOffPeak: 0,
      chargesCost: 0,
      municipalTax: 0,
      icmsRate: 0.18,
      pisRate: 0.0765,
      cofinsRate: 0.076,
      previousCredit: 0,
      discount: 0,
      notes: '',
    },
  });

  const watchConsumption = watch(['consumptionKwhPeak', 'consumptionKwhOffPeak', 'demandKwPeak', 'demandKwOffPeak']);
  const watchTariffs = watch(['tusdEnergyRatePeak', 'tusdEnergyRateOffPeak', 'teEnergyRatePeak', 'teEnergyRateOffPeak']);

  useEffect(() => {
    const [peakKwh, offPeakKwh] = watchConsumption;
    const [tusdPeak, tusdOffPeak, tePeak, teOffPeak] = watchTariffs;

    const freeMarket = (peakKwh || 0) * (tusdPeak || 0) + (offPeakKwh || 0) * (tusdOffPeak || 0) +
                       (peakKwh || 0) * (tePeak || 0) + (offPeakKwh || 0) * (teOffPeak || 0);
    const regulated = freeMarket * 1.15;

    const savings = regulated - freeMarket;
    const savingsPerc = regulated > 0 ? (savings / regulated) * 100 : 0;

    setEconomyCalc({
      regulatedCost: regulated,
      freeMarketCost: freeMarket,
      savings,
      savingsPercentage: savingsPerc,
    });
  }, [watchConsumption, watchTariffs]);

  const onSubmit = async (data: any) => {
    setLoading(true);
    setApiError(null);

    try {
      const invoiceData = {
        organizationId: 'org-default',
        consumerUnitId,
        energyContractId: contractId,
        ...data,
      };

      const response = await api.invoices.create(invoiceData);
      
      if (response.data && response.statusCode === 200) {
        const invoice = response.data as Invoice;
        onSuccess?.(invoice);
        reset();
      } else {
        throw new Error(response.message || 'Erro ao criar fatura');
      }
    } catch (err: any) {
      const errorMsg = err.response?.data?.message || err.message || 'Erro ao criar fatura';
      setApiError(errorMsg);
      onError?.(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? '' : section);
  };

  const SectionHeader = ({ icon, title, section }: { icon: string; title: string; section: string }) => (
    <button
      type="button"
      onClick={() => toggleSection(section)}
      className="w-full flex items-center justify-between px-4 py-3 bg-slate-700 hover:bg-slate-600 transition rounded-lg mb-4"
    >
      <span className="flex items-center gap-2 font-semibold text-white">
        {icon} {title}
      </span>
      {expandedSection === section ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
    </button>
  );

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 bg-slate-800 p-6 rounded-lg shadow-lg border border-slate-700">
      <h2 className="text-2xl font-bold text-white">📋 Nova Fatura</h2>

      {apiError && (
        <div className="p-4 bg-red-900/50 border border-red-700 text-red-200 rounded-lg">
          {apiError}
        </div>
      )}

      {/* SEÇÃO 1: Identificação */}
      <div>
        <SectionHeader icon="📝" title="Identificação" section="identification" />
        {expandedSection === 'identification' && (
          <div className="grid grid-cols-2 gap-4 bg-slate-750 p-4 rounded-lg">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Nº Fatura</label>
              <input {...register('invoiceNumber')} type="text" className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white" placeholder="Ex: INV-202601-1234" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Mês/Ano Referência</label>
              <input {...register('referenceMonth')} type="date" className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white" />
            </div>
          </div>
        )}
      </div>

      {/* SEÇÃO 2: Concessionária */}
      <div>
        <SectionHeader icon="🏢" title="Concessionária e UC" section="distributor" />
        {expandedSection === 'distributor' && (
          <div className="grid grid-cols-2 gap-4 bg-slate-750 p-4 rounded-lg">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Distribuidora</label>
              <input {...register('distributorName')} type="text" className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white" placeholder="Ex: CPFL, Enel" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">CNPJ</label>
              <input {...register('distributorCnpj')} type="text" className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white" placeholder="12.345.678/0001-90" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">UC</label>
              <input {...register('consumerUnitNumber')} type="text" className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white" placeholder="4001234567891" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Medidor</label>
              <input {...register('meterNumber')} type="text" className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white" placeholder="00123456789" />
            </div>
          </div>
        )}
      </div>

      {/* SEÇÃO 3: Modalidade e Consumo */}
      <div>
        <SectionHeader icon="⚡" title="Consumo e Demanda" section="consumption" />
        {expandedSection === 'consumption' && (
          <div className="grid grid-cols-3 gap-4 bg-slate-750 p-4 rounded-lg">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Modalidade Tarifária</label>
              <select {...register('tariffModality')} className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white">
                <option value="conventional">Convencional</option>
                <option value="green">Verde (Demanda Única)</option>
                <option value="blue">Azul (Ponta/Fora Ponta)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Consumo Ponta (kWh)</label>
              <input {...register('consumptionKwhPeak', { valueAsNumber: true })} type="number" step="0.01" className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Consumo Fora Ponta (kWh)</label>
              <input {...register('consumptionKwhOffPeak', { valueAsNumber: true })} type="number" step="0.01" className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Demanda Ponta (kW)</label>
              <input {...register('demandKwPeak', { valueAsNumber: true })} type="number" step="0.01" className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Demanda Fora Ponta (kW)</label>
              <input {...register('demandKwOffPeak', { valueAsNumber: true })} type="number" step="0.01" className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Demanda Cobrada (kW)</label>
              <input {...register('demandKwBilled', { valueAsNumber: true })} type="number" step="0.01" className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white" />
            </div>
          </div>
        )}
      </div>

      {/* SEÇÃO 4: Tarifas (TUSD e TE) */}
      <div>
        <SectionHeader icon="💰" title="Tarifas (R$/kWh)" section="tariffs" />
        {expandedSection === 'tariffs' && (
          <div className="grid grid-cols-3 gap-4 bg-slate-750 p-4 rounded-lg">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">TUSD Ponta (R$/kWh)</label>
              <input {...register('tusdEnergyRatePeak', { valueAsNumber: true })} type="number" step="0.000001" className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">TUSD Fora Ponta (R$/kWh)</label>
              <input {...register('tusdEnergyRateOffPeak', { valueAsNumber: true })} type="number" step="0.000001" className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">TE Ponta (R$/kWh)</label>
              <input {...register('teEnergyRatePeak', { valueAsNumber: true })} type="number" step="0.000001" className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">TE Fora Ponta (R$/kWh)</label>
              <input {...register('teEnergyRateOffPeak', { valueAsNumber: true })} type="number" step="0.000001" className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Demanda Ponta (R$/kW)</label>
              <input {...register('demandRatePeak', { valueAsNumber: true })} type="number" step="0.000001" className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Demanda Fora Ponta (R$/kW)</label>
              <input {...register('demandRateOffPeak', { valueAsNumber: true })} type="number" step="0.000001" className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white" />
            </div>
          </div>
        )}
      </div>

      {/* SEÇÃO 5: Encargos */}
      <div>
        <SectionHeader icon="📊" title="Encargos e Taxas" section="charges" />
        {expandedSection === 'charges' && (
          <div className="grid grid-cols-3 gap-4 bg-slate-750 p-4 rounded-lg">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Encargos Setoriais (R$)</label>
              <input {...register('chargesCost', { valueAsNumber: true })} type="number" step="0.01" className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Taxa Municipal (R$)</label>
              <input {...register('municipalTax', { valueAsNumber: true })} type="number" step="0.01" className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white" />
            </div>
          </div>
        )}
      </div>

      {/* SEÇÃO 6: Impostos */}
      <div>
        <SectionHeader icon="🏛️" title="Impostos (%)" section="taxes" />
        {expandedSection === 'taxes' && (
          <div className="grid grid-cols-3 gap-4 bg-slate-750 p-4 rounded-lg">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">ICMS (%)</label>
              <input {...register('icmsRate', { valueAsNumber: true })} type="number" step="0.01" min="0" max="100" className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">PIS (%)</label>
              <input {...register('pisRate', { valueAsNumber: true })} type="number" step="0.01" min="0" max="100" className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">COFINS (%)</label>
              <input {...register('cofinsRate', { valueAsNumber: true })} type="number" step="0.01" min="0" max="100" className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white" />
            </div>
          </div>
        )}
      </div>

      {/* SEÇÃO 7: Crédito e Descontos */}
      <div>
        <SectionHeader icon="💳" title="Crédito e Descontos" section="credits" />
        {expandedSection === 'credits' && (
          <div className="grid grid-cols-2 gap-4 bg-slate-750 p-4 rounded-lg">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Crédito Anterior (R$)</label>
              <input {...register('previousCredit', { valueAsNumber: true })} type="number" step="0.01" className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Desconto (R$)</label>
              <input {...register('discount', { valueAsNumber: true })} type="number" step="0.01" className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white" />
            </div>
          </div>
        )}
      </div>

      {/* SEÇÃO 8: Observações */}
      <div>
        <SectionHeader icon="📝" title="Observações" section="notes" />
        {expandedSection === 'notes' && (
          <div className="bg-slate-750 p-4 rounded-lg">
            <textarea {...register('notes')} className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white" rows={4} placeholder="Observações ou comentários sobre a fatura..." />
          </div>
        )}
      </div>

      {/* Resumo de Economia */}
      <div className="grid grid-cols-4 gap-4 bg-green-900/30 p-4 rounded-lg border border-green-800">
        <div>
          <p className="text-sm text-green-300">Mercado Regulado</p>
          <p className="text-xl font-bold text-green-400">R$ {economyCalc.regulatedCost.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</p>
        </div>
        <div>
          <p className="text-sm text-green-300">Mercado Livre</p>
          <p className="text-xl font-bold text-green-400">R$ {economyCalc.freeMarketCost.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</p>
        </div>
        <div>
          <p className="text-sm text-green-300">Economia</p>
          <p className="text-xl font-bold text-green-400">R$ {economyCalc.savings.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</p>
        </div>
        <div>
          <p className="text-sm text-green-300">% Economia</p>
          <p className="text-xl font-bold text-green-400">{economyCalc.savingsPercentage.toFixed(2)}%</p>
        </div>
      </div>

      {/* Botões */}
      <div className="flex gap-4 justify-end">
        <button
          type="button"
          className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition font-medium"
          onClick={() => reset()}
        >
          Limpar
        </button>
        <button
          type="submit"
          disabled={loading}
          className="px-6 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-orange-800 text-white rounded-lg transition font-medium flex items-center gap-2"
        >
          {loading ? <Loader className="animate-spin" size={16} /> : null}
          {loading ? 'Criando...' : 'Criar Fatura'}
        </button>
      </div>
    </form>
  );
}
