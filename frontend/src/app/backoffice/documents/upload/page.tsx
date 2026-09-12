'use client';

import { useState } from 'react';
import { Upload, FileText, AlertCircle, CheckCircle } from 'lucide-react';
import axios from 'axios';

export default function DocumentUploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles.length > 0) {
      validateAndSetFile(droppedFiles[0]);
    }
  };

  const validateAndSetFile = (selectedFile: File) => {
    const validTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    const maxSize = 10 * 1024 * 1024; // 10MB

    if (!validTypes.includes(selectedFile.type)) {
      setError('Formato inválido. Aceitos: PDF, JPEG, PNG');
      return;
    }

    if (selectedFile.size > maxSize) {
      setError('Arquivo muito grande. Máximo: 10MB');
      return;
    }

    setFile(selectedFile);
    setError(null);
    setResult(null);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Selecione um arquivo');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await axios.post(
        `${API_URL}/api/document-processing/upload`,
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
        }
      );

      setResult(response.data);
      setFile(null);
    } catch (err: any) {
      setError(
        err.response?.data?.message ||
        err.message ||
        'Erro ao fazer upload'
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          Upload de Faturas
        </h1>

        {/* Dropzone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
            isDragging
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-300 bg-white'
          }`}
        >
          <Upload className="w-16 h-16 mx-auto mb-4 text-gray-400" />
          <p className="text-lg font-medium text-gray-900 mb-2">
            Arraste arquivos aqui
          </p>
          <p className="text-sm text-gray-500 mb-6">
            ou clique para selecionar
          </p>
          <input
            type="file"
            id="file-input"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={handleFileInputChange}
            className="hidden"
          />
          <label
            htmlFor="file-input"
            className="inline-block px-6 py-2 bg-blue-600 text-white rounded-lg cursor-pointer hover:bg-blue-700"
          >
            Selecionar Arquivo
          </label>
          <p className="text-xs text-gray-400 mt-4">
            PDF, JPEG ou PNG • Máximo 10MB
          </p>
        </div>

        {/* Arquivo Selecionado */}
        {file && (
          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <FileText className="w-6 h-6 text-blue-600 mr-3" />
                <div>
                  <p className="font-medium text-gray-900">{file.name}</p>
                  <p className="text-sm text-gray-500">
                    {(file.size / 1024).toFixed(2)} KB
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setFile(null);
                  setResult(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Erros */}
        {error && (
          <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start">
            <AlertCircle className="w-5 h-5 text-red-600 mr-3 mt-0.5 flex-shrink-0" />
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {/* Resultado */}
        {result && (
          <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-start mb-4">
              <CheckCircle className="w-6 h-6 text-green-600 mr-3 flex-shrink-0" />
              <div>
                <p className="font-medium text-green-900">Upload realizado!</p>
                <p className="text-sm text-green-800 mt-1">
                  ID do Documento: {result.documentId}
                </p>
              </div>
            </div>

            {result.extraction && (
              <div className="mt-4 pt-4 border-t border-green-200">
                <p className="font-medium text-gray-900 mb-2">
                  Dados Extraídos:
                </p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-gray-600">Número da Fatura:</p>
                    <p className="font-mono text-gray-900">
                      {result.extraction.invoiceNumber || '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-600">Confiança:</p>
                    <p className="font-mono text-gray-900">
                      {result.extraction.confidenceLevel || '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-600">Consumo (kWh):</p>
                    <p className="font-mono text-gray-900">
                      {result.extraction.consumptionKwh || '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-600">Total:</p>
                    <p className="font-mono text-gray-900">
                      {result.extraction.totalAmount
                        ? `R$ ${result.extraction.totalAmount.toFixed(2)}`
                        : '—'}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Botão Upload */}
        {file && !result && (
          <button
            onClick={handleUpload}
            disabled={uploading}
            className="mt-6 w-full px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {uploading ? 'Enviando...' : 'Fazer Upload'}
          </button>
        )}

        {result && (
          <button
            onClick={() => {
              setResult(null);
              setFile(null);
              setError(null);
            }}
            className="mt-6 w-full px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700"
          >
            Fazer Novo Upload
          </button>
        )}
      </div>
    </div>
  );
}
