'use client';
import { useState, useEffect } from 'react';
import { FileText, Loader } from 'lucide-react';
import axios from 'axios';

export default function DocumentHistoryPage() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDocuments();
  }, []);

  const loadDocuments = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const response = await axios.get(
        `${process.env.NEXT_PUBLIC_API_URL}/api/document-processing`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      setDocuments(response.data.documents || []);
    } catch (error) {
      console.error('Erro:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-3">
          <FileText size={32} className="text-blue-400" />
          Histórico de Faturas
        </h1>
        <p className="text-slate-400 mb-8">Todas as faturas processadas</p>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader className="animate-spin text-blue-400" size={32} />
          </div>
        ) : documents.length === 0 ? (
          <div className="bg-slate-800 rounded-lg p-12 text-center border border-slate-700">
            <FileText size={48} className="mx-auto text-slate-600 mb-4" />
            <p className="text-slate-400">Nenhuma fatura processada</p>
          </div>
        ) : (
          <div className="bg-slate-800 rounded-lg overflow-hidden border border-slate-700">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-900">
                  <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">
                    Arquivo
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">
                    Data
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc: any) => (
                  <tr key={doc.id} className="border-b border-slate-700 hover:bg-slate-700/50">
                    <td className="px-6 py-4 text-slate-200">{doc.filename}</td>
                    <td className="px-6 py-4 text-slate-400 text-sm">
                      {new Date(doc.uploadedAt).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-3 py-1 rounded-full text-xs font-semibold border bg-slate-700 border-slate-600 text-slate-300">
                        {doc.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
