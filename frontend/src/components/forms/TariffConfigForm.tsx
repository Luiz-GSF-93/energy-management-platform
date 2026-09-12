'use client';

import { useState } from 'react';
import { TariffConfig } from '@/types/tariff';

interface TariffConfigFormProps {
  initialData?: TariffConfig;
  onSubmit?: (data: TariffConfig) => void;
}

export function TariffConfigForm({
  initialData,
  onSubmit,
}: TariffConfigFormProps) {
  const [formData, setFormData] = useState<TariffConfig>(
    initialData || {
      id: '',
      name: '',
      distributorId: '',
      consumerUnitId: '',
      referenceMonth: new Date(),
      status: 'ACTIVE',
      regulated: 0,
      acl: 0,
      taxes: 0,
      management: 0,
    }
  );

  return (
    <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
      <h2 className="text-xl font-bold text-white mb-4">Configuração de Tarifas</h2>
      <div className="space-y-4">
        <input
          type="text"
          placeholder="Nome da Tarifa"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
        />
        <input
          type="number"
          placeholder="Regulado (R$/kWh)"
          value={formData.regulated}
          onChange={(e) => setFormData({ ...formData, regulated: parseFloat(e.target.value) })}
          className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
        />
        <input
          type="number"
          placeholder="ACL (R$/kWh)"
          value={formData.acl}
          onChange={(e) => setFormData({ ...formData, acl: parseFloat(e.target.value) })}
          className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
        />
        <input
          type="number"
          placeholder="Impostos (%)"
          value={formData.taxes}
          onChange={(e) => setFormData({ ...formData, taxes: parseFloat(e.target.value) })}
          className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
        />
        <input
          type="number"
          placeholder="Gestão (R$/mês)"
          value={formData.management}
          onChange={(e) => setFormData({ ...formData, management: parseFloat(e.target.value) })}
          className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
        />
        <button
          onClick={() => onSubmit?.(formData)}
          className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg"
        >
          Salvar Configuração
        </button>
      </div>
    </div>
  );
}
