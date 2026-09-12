'use client';
import { useState, useRef } from 'react';
import { Upload, CheckCircle, AlertCircle, Loader, Trash2 } from 'lucide-react';
import axios from 'axios';

export default function DocumentUploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && ['application/pdf', 'image/jpeg', 'image/png'].includes(droppedFile.type)) {
      setFile(droppedFile);
      setResult(null);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setResult(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const token = localStorage.getItem('auth_token');
      const response = await axios.post(
        `${process.env.NEXT_PUBLIC_API_URL}/api/document-processing/upload`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
            Authorization: `Bearer ${token}`,
          },
        },
      );

      setResult(response.data);
    } catch (error: any) {
      console.error('Erro:', error);
      setResult({
        success: false,
        error: error.response?.data?.message || 'Erro ao fazer upload',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setResult(null);
  };

  return (
    <div className="min-h-screen bg-slate-900 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-3">
            <Upload size={32} className="text-blue-400" />
            Upload de Faturas
          </h1>
          <p className="text-slate-400">
            Envie sua fatura de energia em PDF ou imagem para processamento automático
          </p>
        </div>

        {!result ? (
          <div className="bg-slate-800 rounded-lg border-2 border-dashed border-slate-700 p-12">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              className="text-center cursor-pointer"
            >
              <Upload size={48} className="mx-auto text-blue-400 mb-4" />
              <h2 className="text-2xl font-semibold text-white mb-2">
                Arraste seu arquivo aqui
              </h2>
              <p className="text-slate-400 mb-4">ou clique para selecionar</p>
              <p className="text-sm text-slate-500">
                Formatos: PDF, PNG, JPEG | Máximo: 10MB
              </p>

              <input
                ref={fileInputRef}
                type="file"
                hidden
                accept=".pdf,.png,.jpg,.jpeg"
                onChange={handleFileSelect}
              />
            </div>

            {file && (
              <div className="mt-8 p-4 bg-slate-700 rounded-lg border border-slate-600">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white font-semibold">📎 {file.name}</p>
                    <p className="text-slate-400 text-sm">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                  <button
                    onClick={() => setFile(null)}
                    className="p-2 hover:bg-slate-600 rounded-lg text-slate-300 transition"
                  >
                    <Trash2 size={20} />
                  </button>
                </div>

                <button
                  onClick={handleUpload}
                  disabled={loading}
                  className="mt-4 w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white font-semibold rounded-lg transition flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader className="animate-spin" size={18} />
                      Processando...
                    </>
                  ) : (
                    <>
                      <Upload size={18} />
                      Enviar Fatura
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {result.success !== false ? (
              <div
                className={`flex items-start gap-4 p-4 rounded-lg border ${
                  result.extraction?.confidenceLevel === 'HIGH'
                    ? 'bg-green-900/30 border-green-700'
                    : 'bg-yellow-900/30 border-yellow-700'
                }`}
              >
                {result.extraction?.confidenceLevel === 'HIGH' ? (
                  <CheckCircle className="text-green-500 flex-shrink-0 mt-1" size={24} />
                ) : (
                  <AlertCircle className="text-yellow-500 flex-shrink-0 mt-1" size={24} />
                )}
                <div>
                  <h3
                    className={`text-lg font-semibold ${
                      result.extraction?.confidenceLevel === 'HIGH'
                        ? 'text-green-400'
                        : 'text-yellow-400'
                    }`}
                  >
                    {result.extraction?.confidenceLevel === 'HIGH'
                      ? '✅ Fatura Processada'
                      : '⚠️ Revisão Necessária'}
                  </h3>
                  <p
                    className={
                      result.extraction?.confidenceLevel === 'HIGH'
                        ? 'text-green-300'
                        : 'text-yellow-300'
                    }
                  >
                    Confiança: {result.extraction?.confidenceScore}%
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-4 p-4 bg-red-900/30 border border-red-700 rounded-lg">
                <AlertCircle className="text-red-500 flex-shrink-0 mt-1" size={24} />
                <div>
                  <h3 className="text-lg font-semibold text-red-400">❌ Erro</h3>
                  <p className="text-red-300">{result.error}</p>
                </div>
              </div>
            )}

            {result.extraction && (
              <>
                <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                  <h3 className="text-xl font-bold text-white mb-4">📊 Dados Extraídos</h3>
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <p className="text-slate-400 text-sm mb-1">Número da Fatura</p>
                      <p className="text-white font-semibold">
                        {result.extraction.structuredData?.invoiceNumber || 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-sm mb-1">Período</p>
                      <p className="text-white font-semibold">
                        {result.extraction.structuredData?.referenceMonth || 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-sm mb-1">Consumo (kWh)</p>
                      <p className="text-white font-semibold">
                        {result.extraction.structuredData?.consumptionKwh?.toLocaleString(
                          'pt-BR',
                        ) || 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-sm mb-1">Valor Total</p>
                      <p className="text-white font-semibold">
                        R${' '}
                        {result.extraction.structuredData?.totalAmount?.toLocaleString(
                          'pt-BR',
                          { minimumFractionDigits: 2 },
                        ) || 'N/A'}
                      </p>
                    </div>
                  </div>
                </div>

                {result.extraction.validationNotes && (
                  <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                    <h3 className="text-lg font-bold text-white mb-3">ℹ️ Observações</h3>
                    <div className="text-slate-300 text-sm whitespace-pre-wrap">
                      {result.extraction.validationNotes}
                    </div>
                  </div>
                )}

                <button
                  onClick={handleReset}
                  className="w-full px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-lg transition"
                >
                  Nova Fatura
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
