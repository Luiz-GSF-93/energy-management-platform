'use client';
import { AlertCircle, CheckCircle } from 'lucide-react';

export default function PendingReviewPage() {
  return (
    <div className="min-h-screen bg-slate-900 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-3">
          <AlertCircle size={32} className="text-yellow-400" />
          Validações Pendentes
        </h1>
        <p className="text-slate-400 mb-8">Faturas que precisam revisão</p>

        <div className="bg-slate-800 rounded-lg p-12 text-center border border-slate-700">
          <CheckCircle size={48} className="mx-auto text-green-500 mb-4" />
          <p className="text-slate-300 font-semibold">Tudo em dia!</p>
          <p className="text-slate-400">Nenhuma fatura pendente</p>
        </div>
      </div>
    </div>
  );
}
