'use client';

import { useState } from 'react';

export default function CreateInvoiceForm() {
  const [loading, setLoading] = useState(false);

  return (
    <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
      <h2 className="text-xl font-bold text-white mb-6">Motor de Cálculo</h2>
      <form className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input type="text" placeholder="UC" className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white" />
          <input type="text" placeholder="Contrato" className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white" />
          <input type="month" className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white" />
        </div>
        <button type="button" disabled={loading} className="w-full px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg">
          Calcular
        </button>
      </form>
    </div>
  );
}
