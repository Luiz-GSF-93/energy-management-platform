'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { TariffConfig } from '@/types/tariff';
import { ChevronDown, ChevronUp, Save } from 'lucide-react';

interface TariffConfigFormProps {
  initialData?: TariffConfig;
  onSubmit?: (data: TariffConfig) => void;
  onCalculate?: (data: TariffConfig) => void;
}

export function TariffConfigForm({
  initialData,
  onSubmit,
  onCalculate,
}: TariffConfigFormProps) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    regulatedTusd: true,
    regulatedTe: true,
    aclDistribution: true,
    aclGenerator: true,
    aclCcee: false,
    taxes: true,
    management: true,
  });

  const { register, handleSubmit, watch, reset } = useForm<TariffConfig>({
    defaultValues: initialData || {
      name: 'Tarifas Padrão',
      status: 'DRAFT',
      regulated: {
        tusd: { peakRate: 0, offPeakRate: 0, demandRate: 0 },
        te: { peakRate: 0, offPeakRate: 0 },
      },
      acl: {
        distribution: { tusdPeakRate: 0, tusdOffPeakRate: 0, demandRate: 0, cdeCovid: 0, cdeWater: 0 },
        generator: { ratePerMwh: 150 },
        ccee: {
          associativeContribution: 0,
          eer: 0,
          ercap: 0,
          financialGuarantee: 0,
          penalties: 0,
          liquidationMcp: 0,
          nuclearQuotas: 0,
        },
      },
      taxes: { pisFederal: 7.65, cofinsFederal: 7.6, icmsState: 18 },
      management: { model: 'HYBRID', fixedMonthlyCost: 1000, percentageOnSavings: 15 },
    },
  });

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const SectionHeader = ({ title, section }: { title: string; section: string }) => (
    <button
      type="button"
      onClick={() => toggleSection(section)}
      className="w-full flex items-center justify-between py-2 px-3 bg-slate-700 hover:bg-slate-600 transition rounded-t"
    >
      <span className="font-semibold text-slate-200 text-sm">{title}</span>
      {expandedSections[section] ? (
        <ChevronUp size={18} className="text-orange-500" />
      ) : (
        <ChevronDown size={18} className="text-slate-400" />
      )}
    </button>
  );

  return (
    <form onSubmit={handleSubmit((data) => onSubmit?.(data))} className="space-y-3 bg-slate-900 p-4 rounded-lg border border-slate-700">
      <h3 className="text-lg font-bold text-white">⚙️ Configuração de Tarifas</h3>

      {/* 1. TUSD Regulado */}
      <div className="border border-slate-700 rounded overflow-hidden">
        <SectionHeader title="1. TUSD Mercado Regulado (R$/kWh e R$/kW)" section="regulatedTusd" />
        {expandedSections.regulatedTusd && (
          <div className="p-3 bg-slate-800/50 grid grid-cols-1 md:grid-cols-3 gap-2">
            <div>
              <label className="text-xs font-semibold text-slate-300">TUSD Ponta (R$/kWh)</label>
              <input type="number" step="0.0001" {...register('regulated.tusd.peakRate', { valueAsNumber: true })} className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-xs focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300">TUSD Fora Ponta (R$/kWh)</label>
              <input type="number" step="0.0001" {...register('regulated.tusd.offPeakRate', { valueAsNumber: true })} className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-xs focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300">Demanda (R$/kW)</label>
              <input type="number" step="0.01" {...register('regulated.tusd.demandRate', { valueAsNumber: true })} className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-xs focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
          </div>
        )}
      </div>

      {/* 2. TE Regulado */}
      <div className="border border-slate-700 rounded overflow-hidden">
        <SectionHeader title="2. TE Mercado Regulado (R$/kWh)" section="regulatedTe" />
        {expandedSections.regulatedTe && (
          <div className="p-3 bg-slate-800/50 grid grid-cols-1 md:grid-cols-3 gap-2">
            <div>
              <label className="text-xs font-semibold text-slate-300">TE Ponta (R$/kWh)</label>
              <input type="number" step="0.0001" {...register('regulated.te.peakRate', { valueAsNumber: true })} className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-xs focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300">TE Fora Ponta (R$/kWh)</label>
              <input type="number" step="0.0001" {...register('regulated.te.offPeakRate', { valueAsNumber: true })} className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-xs focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
          </div>
        )}
      </div>

      {/* 3. Distribuição ACL */}
      <div className="border border-slate-700 rounded overflow-hidden">
        <SectionHeader title="3. Distribuição ACL (TUSD Ponta/F.Ponta + CDE)" section="aclDistribution" />
        {expandedSections.aclDistribution && (
          <div className="p-3 bg-slate-800/50 grid grid-cols-1 md:grid-cols-4 gap-2">
            <div>
              <label className="text-xs font-semibold text-slate-300">TUSD Ponta (R$/kWh)</label>
              <input type="number" step="0.0001" {...register('acl.distribution.tusdPeakRate', { valueAsNumber: true })} className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-xs focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300">TUSD F.Ponta (R$/kWh)</label>
              <input type="number" step="0.0001" {...register('acl.distribution.tusdOffPeakRate', { valueAsNumber: true })} className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-xs focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300">Demanda (R$/kW)</label>
              <input type="number" step="0.01" {...register('acl.distribution.demandRate', { valueAsNumber: true })} className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-xs focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300">CDE-COVID (R$)</label>
              <input type="number" step="0.01" {...register('acl.distribution.cdeCovid', { valueAsNumber: true })} className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-xs focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300">CDE Escassez (R$)</label>
              <input type="number" step="0.01" {...register('acl.distribution.cdeWater', { valueAsNumber: true })} className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-xs focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
          </div>
        )}
      </div>

      {/* 4. Gerador ACL */}
      <div className="border border-slate-700 rounded overflow-hidden">
        <SectionHeader title="4. Gerador (Fornecedor Energia)" section="aclGenerator" />
        {expandedSections.aclGenerator && (
          <div className="p-3 bg-slate-800/50">
            <div className="max-w-xs">
              <label className="text-xs font-semibold text-slate-300">Taxa (R$/MWh)</label>
              <input type="number" step="0.01" {...register('acl.generator.ratePerMwh', { valueAsNumber: true })} className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-xs focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
          </div>
        )}
      </div>

      {/* 5. CCEE */}
      <div className="border border-slate-700 rounded overflow-hidden">
        <SectionHeader title="5. CCEE (Câmara de Comercialização)" section="aclCcee" />
        {expandedSections.aclCcee && (
          <div className="p-3 bg-slate-800/50 grid grid-cols-1 md:grid-cols-3 gap-2">
            <div>
              <label className="text-xs font-semibold text-slate-300">Contrib. Associativa (R$)</label>
              <input type="number" step="0.01" {...register('acl.ccee.associativeContribution', { valueAsNumber: true })} className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-xs focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300">EER (R$)</label>
              <input type="number" step="0.01" {...register('acl.ccee.eer', { valueAsNumber: true })} className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-xs focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300">ERCAP (R$)</label>
              <input type="number" step="0.01" {...register('acl.ccee.ercap', { valueAsNumber: true })} className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-xs focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300">Garantia Financeira (R$)</label>
              <input type="number" step="0.01" {...register('acl.ccee.financialGuarantee', { valueAsNumber: true })} className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-xs focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300">Penalidades (R$)</label>
              <input type="number" step="0.01" {...register('acl.ccee.penalties', { valueAsNumber: true })} className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-xs focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300">Liquidação MCP (R$)</label>
              <input type="number" step="0.01" {...register('acl.ccee.liquidationMcp', { valueAsNumber: true })} className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-xs focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300">Cotas E.Nuclear (R$)</label>
              <input type="number" step="0.01" {...register('acl.ccee.nuclearQuotas', { valueAsNumber: true })} className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-xs focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
          </div>
        )}
      </div>

      {/* 6. Impostos */}
      <div className="border border-slate-700 rounded overflow-hidden">
        <SectionHeader title="6. Impostos (%)" section="taxes" />
        {expandedSections.taxes && (
          <div className="p-3 bg-slate-800/50 grid grid-cols-1 md:grid-cols-3 gap-2">
            <div>
              <label className="text-xs font-semibold text-slate-300">PIS Federal (%)</label>
              <input type="number" step="0.01" {...register('taxes.pisFederal', { valueAsNumber: true })} className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-xs focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300">COFINS Federal (%)</label>
              <input type="number" step="0.01" {...register('taxes.cofinsFederal', { valueAsNumber: true })} className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-xs focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300">ICMS Estadual (%)</label>
              <input type="number" step="0.01" {...register('taxes.icmsState', { valueAsNumber: true })} className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-xs focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
          </div>
        )}
      </div>

      {/* 7. Remuneração */}
      <div className="border border-slate-700 rounded overflow-hidden">
        <SectionHeader title="7. Modelo de Remuneração" section="management" />
        {expandedSections.management && (
          <div className="p-3 bg-slate-800/50 space-y-2">
            <div>
              <label className="text-xs font-semibold text-slate-300">Modelo</label>
              <select {...register('management.model')} className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-xs focus:outline-none focus:ring-2 focus:ring-orange-500">
                <option value="FIXED">Fixo</option>
                <option value="HYBRID">Híbrido</option>
                <option value="PERCENTAGE">Percentual</option>
              </select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-semibold text-slate-300">Custo Fixo (R$/mês)</label>
                <input type="number" step="0.01" {...register('management.fixedMonthlyCost', { valueAsNumber: true })} className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-xs focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-300">% sobre Economia</label>
                <input type="number" step="0.01" {...register('management.percentageOnSavings', { valueAsNumber: true })} className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-xs focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Botões */}
      <div className="flex gap-2 pt-2">
        <button type="submit" className="flex-1 px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded text-sm font-semibold transition flex items-center justify-center gap-2">
          <Save size={16} /> Salvar Tarifas
        </button>
        <button
          type="button"
          onClick={() => {
            const formData = watch();
            onCalculate?.(formData as TariffConfig);
          }}
          className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-semibold transition"
        >
          📊 Calcular
        </button>
      </div>
    </form>
  );
}
