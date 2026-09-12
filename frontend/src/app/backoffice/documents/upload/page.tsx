'use client';

import { useState, useEffect } from 'react';
import { Upload, FileText, AlertCircle, CheckCircle } from 'lucide-react';
import axios from 'axios';

export default function DocumentUploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState('org-expertev-test-001');
  const [uploadProgress, setUploadProgress] = useState(0);

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
    const maxSize = 10 * 1024 * 1024;

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
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append('file', file);

      console.log(`📤 === INICIANDO UPLOAD ===`);
      console.log(`📄 Arquivo: ${file.name}`);
      console.log(`📦 Tamanho: ${file.size} bytes`);
      console.log(`📋 Tipo MIME: ${file.type}`);
      console.log(`🏢 Organization: ${organizationId}`);
      console.log(`🌐 Endpoint: ${API_URL}/api/document-processing/upload`);

      const response = await axios.post(
        `${API_URL}/api/document-processing/upload`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
            'x-organization-id': organizationId,
          },
          onUploadProgress: (progressEvent) => {
            const percentCompleted = Math.round(
              (progressEvent.loaded * 100) / (progressEvent.total || 1)
            );
            setUploadProgress(percentCompleted);
            console.log(`📊 Progresso: ${percentCompleted}%`);
          },
        }
      );

      console.log(`✅ === UPLOAD BEM-SUCEDIDO ===`);
      console.log(`📥 Resposta do servidor:`, response.data);
      
      setResult(response.data);
      setFile(null);
    } catch (err: any) {
      console.error('❌ === ERRO NO UPLOAD ===');
      console.error('Erro completo:', err);
      
      if (err.response) {
        console.error('Status:', err.response.status);
        console.error('Data:', err.response.data);
      } else if (err.request) {
        console.error('Sem resposta do servidor:', err.request);
      } else {
        console.error('Erro na configuração:', err.message);
      }

      const errorMsg =
        err.response?.data?.message ||
        err.response?.data?.error ||
        err.message ||
        'Erro ao fazer upload';
      setError(errorMsg);
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Upload de Faturas
        </h1>
        <p className="text-gray-600 mb-8">
          Organização: <strong>{organizationId}</strong>
        </p>

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

        {/* Progress Bar */}
        {uploading && uploadProgress > 0 && (
          <div className="mt-6">
            <div className="flex justify-between mb-2">
              <p className="text-sm font-medium text-gray-900">Enviando...</p>
              <p className="text-sm font-medium text-gray-900">{uploadProgress}%</p>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{ width: `${uploadProgress}%` }}
              ></div>
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
                <p className="font-medium text-gray-900 mb-3">
                  Dados Extraídos:
                </p>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="bg-white p-3 rounded border border-green-100">
                    <p className="text-gray-600 text-xs uppercase">Número da Fatura</p>
                    <p className="font-mono text-gray-900 font-semibold">
                      {result.extraction.invoiceNumber || '—'}
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded border border-green-100">
                    <p className="text-gray-600 text-xs uppercase">Distribuidor</p>
                    <p className="font-mono text-gray-900 font-semibold">
                      {result.extraction.distributor || '—'}
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded border border-green-100">
                    <p className="text-gray-600 text-xs uppercase">Mês</p>
                    <p className="font-mono text-gray-900 font-semibold">
                      {result.extraction.referenceMonth || '—'}
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded border border-green-100">
                    <p className="text-gray-600 text-xs uppercase">Consumo (kWh)</p>
                    <p className="font-mono text-gray-900 font-semibold">
                      {result.extraction.consumptionKwh || '—'}
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded border border-green-100">
                    <p className="text-gray-600 text-xs uppercase">Total</p>
                    <p className="font-mono text-gray-900 font-semibold">
                      {result.extraction.totalAmount
                        ? `R$ ${result.extraction.totalAmount.toFixed(2)}`
                        : '—'}
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded border border-green-100">
                    <p className="text-gray-600 text-xs uppercase">Confiança</p>
                    <p className={`font-semibold ${
                      result.extraction.confidenceLevel === 'HIGH' ? 'text-green-600' :
                      result.extraction.confidenceLevel === 'MEDIUM' ? 'text-yellow-600' :
                      'text-red-600'
                    }`}>
                      {result.extraction.confidenceLevel} ({result.extraction.confidenceScore}%)
                    </p>
                  </div>
                </div>

                {result.audit?.contract && (
                  <div className="mt-4 p-3 bg-white border border-green-100 rounded">
                    <p className="text-sm font-medium text-gray-900 mb-2">Validação de Contrato:</p>
                    <p className="text-sm text-gray-600">
                      Status: <strong>{result.audit.contract.status}</strong>
                    </p>
                    {result.audit.contract.observacoes && result.audit.contract.observacoes.length > 0 && (
                      <ul className="mt-2 text-sm text-gray-600 list-disc list-inside">
                        {result.audit.contract.observacoes.map((obs: string, i: number) => (
                          <li key={i}>{obs}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Botão Upload */}
        {file && !result && (
          <button
            onClick={handleUpload}
            disabled={uploading}
            className="mt-6 w-full px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {uploading ? `Enviando (${uploadProgress}%)...` : 'Fazer Upload'}
          </button>
        )}

        {result && (
          <button
            onClick={() => {
              setResult(null);
              setFile(null);
              setError(null);
            }}
            className="mt-6 w-full px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            Fazer Novo Upload
          </button>
        )}
      </div>
    </div>
  );
}
