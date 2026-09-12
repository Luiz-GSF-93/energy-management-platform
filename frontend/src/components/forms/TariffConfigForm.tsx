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
    }
  );

  return (
    <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
      <h2 className="text-xl font-bold text-white mb-4">Configuração de Tarifas</h2>
      <input
        type="text"
        placeholder="Nome da Tarifa"
        value={formData.name}
        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
        className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white mb-4"
      />
      <button
        onClick={() => onSubmit?.(formData)}
        className="w-full px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg"
      >
        Salvar
      </button>
    </div>
  );
}
