'use client';

import { useState, useEffect } from 'react';
import { FileText, Trash2 } from 'lucide-react';

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(false);
    setInvoices([]);
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-3">
          <FileText size={32} className="text-blue-400" />
          Faturas
        </h1>
        <p className="text-slate-400 mb-8">Gerencie suas faturas de energia</p>

        <div className="bg-slate-800 rounded-lg border border-slate-700 p-6">
          <h2 className="text-2xl font-bold text-white mb-6">Faturas Cadastradas</h2>
          {loading ? (
            <p className="text-slate-400">Carregando...</p>
          ) : invoices.length === 0 ? (
            <p className="text-slate-400">Nenhuma fatura cadastrada</p>
          ) : (
            <p>Faturas</p>
          )}
        </div>
      </div>
    </div>
  );
}
