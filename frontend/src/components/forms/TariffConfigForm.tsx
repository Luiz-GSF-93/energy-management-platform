'use client';

import { useState } from 'react';

export function TariffConfigForm() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
      <h2 className="text-xl font-bold text-white mb-4">Configuração de Tarifas</h2>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg"
      >
        {isOpen ? 'Ocultar' : 'Configurar Tarifas'}
      </button>
      {isOpen && (
        <div className="mt-4 p-4 bg-slate-700 rounded-lg">
          <p className="text-slate-300">Configuração de tarifas - em desenvolvimento</p>
        </div>
      )}
    </div>
  );
}
