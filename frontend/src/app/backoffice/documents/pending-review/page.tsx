'use client';

import { AlertCircle, FileText } from 'lucide-react';

export default function PendingReviewPage() {
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          Validações Pendentes
        </h1>

        <div className="bg-white rounded-lg shadow p-12 text-center">
          <FileText className="w-16 h-16 mx-auto text-gray-400 mb-4" />
          <p className="text-lg font-medium text-gray-900 mb-2">
            Nenhuma validação pendente
          </p>
          <p className="text-gray-600">
            Todos os documentos foram processados com sucesso.
          </p>
        </div>

        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <div className="flex">
            <AlertCircle className="w-6 h-6 text-blue-600 mr-3 flex-shrink-0" />
            <div>
              <p className="font-medium text-blue-900">Informação</p>
              <p className="text-sm text-blue-800 mt-1">
                Esta página mostrará documentos que precisam de revisão manual,
                como extrações com baixa confiança ou erros de processamento.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
