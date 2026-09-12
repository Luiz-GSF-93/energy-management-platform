'use client';

import { FileText } from 'lucide-react';
import CreateInvoiceForm from '@/components/forms/CreateInvoiceForm';

export default function InvoicesPage() {
  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-3">
          <FileText size={32} className="text-blue-400" />
          Faturas
        </h1>
        <p className="text-slate-400 mb-8">Gerencie e calcule suas faturas de energia</p>

        <CreateInvoiceForm />

        <div className="mt-8 bg-slate-800 rounded-lg p-6 border border-slate-700">
          <h2 className="text-2xl font-bold text-white mb-4">Faturas Cadastradas</h2>
          <p className="text-slate-400">Nenhuma fatura cadastrada ainda. Use o motor de cálculo acima para gerar faturas.</p>
        </div>
      </div>
    </div>
  );
}
