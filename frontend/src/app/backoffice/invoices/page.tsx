'use client';

import { FileText } from 'lucide-react';
import CreateInvoiceForm from '@/components/forms/CreateInvoiceForm';

export default function InvoicesPage() {
  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-3">
            <FileText size={32} className="text-blue-400" />
            Faturas
          </h1>
          <p className="text-slate-400">Gerencie e calcule suas faturas de energia</p>
        </div>

        <CreateInvoiceForm />
      </div>
    </div>
  );
}
