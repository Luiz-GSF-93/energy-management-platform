'use client';

import { useState } from 'react';
import { Download, FileText, Share2, CheckCircle } from 'lucide-react';
import { ReportService, type ReportData } from '@/lib/report.service';

const mockReportData: ReportData = {
  contractNumber: 'CT-2026-001',
  clientName: 'Empresa XYZ LTDA',
  distributorName: 'CPFL Energia',
  period: '2026',
  metrics: {
    totalSavings: 339840,
    totalRegulated: 3398400,
    totalAcl: 3058560,
    avgSavingsPercent: 10.0,
    avgMonthlySavings: 28320,
    roi: 281.7,
  },
  monthlyData: [
    { month: 'Janeiro', regulatedCost: 283200, aclCost: 254880, savings: 28320 },
    { month: 'Fevereiro', regulatedCost: 283200, aclCost: 254880, savings: 28320 },
    { month: 'Março', regulatedCost: 283200, aclCost: 254880, savings: 28320 },
    { month: 'Abril', regulatedCost: 283200, aclCost: 254880, savings: 28320 },
    { month: 'Maio', regulatedCost: 283200, aclCost: 254880, savings: 28320 },
    { month: 'Junho', regulatedCost: 283200, aclCost: 254880, savings: 28320 },
    { month: 'Julho', regulatedCost: 315000, aclCost: 283500, savings: 31500 },
    { month: 'Agosto', regulatedCost: 315000, aclCost: 283500, savings: 31500 },
    { month: 'Setembro', regulatedCost: 315000, aclCost: 283500, savings: 31500 },
    { month: 'Outubro', regulatedCost: 315000, aclCost: 283500, savings: 31500 },
    { month: 'Novembro', regulatedCost: 315000, aclCost: 283500, savings: 31500 },
    { month: 'Dezembro', regulatedCost: 315000, aclCost: 283500, savings: 31500 },
  ],
  breakdown: {
    tusdEnergy: 960000,
    tusdDemand: 900000,
    teEnergy: 720000,
    charges: 240000,
    taxes: 238560,
  },
};

export default function ReportPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleGeneratePDF = async () => {
    setIsLoading(true);
    try {
      await ReportService.generatePDF(mockReportData);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (error) {
      console.error('Erro ao gerar PDF:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateExcel = async () => {
    setIsLoading(true);
    try {
      await ReportService.generateExcel(mockReportData);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (error) {
      console.error('Erro ao gerar Excel:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateBoth = async () => {
    setIsLoading(true);
    try {
      await ReportService.generateCompleteReport(mockReportData);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (error) {
      console.error('Erro ao gerar relatório completo:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">📄 Relatório de Performance</h1>
          <p className="text-slate-400">Gere relatórios detalhados em múltiplos formatos</p>
        </div>

        {success && (
          <div className="mb-6 p-4 bg-green-900/30 border border-green-500/50 rounded-lg flex items-center gap-3">
            <CheckCircle size={20} className="text-green-400" />
            <span className="text-green-200">✅ Relatório(s) gerado(s) com sucesso!</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <button
            onClick={handleGeneratePDF}
            disabled={isLoading}
            className="px-6 py-4 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition disabled:opacity-50"
          >
            <FileText size={20} />
            Gerar PDF
          </button>
          <button
            onClick={handleGenerateExcel}
            disabled={isLoading}
            className="px-6 py-4 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition disabled:opacity-50"
          >
            <Download size={20} />
            Gerar Excel
          </button>
          <button
            onClick={handleGenerateBoth}
            disabled={isLoading}
            className="px-6 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition disabled:opacity-50"
          >
            <Share2 size={20} />
            Gerar Ambos
          </button>
        </div>

        <div className="bg-slate-800 rounded-lg p-8 border border-slate-700">
          <h2 className="text-2xl font-bold text-white mb-6">Prévia do Relatório</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <div>
              <p className="text-slate-400 text-sm">Contrato</p>
              <p className="text-white text-lg font-semibold">{mockReportData.contractNumber}</p>
            </div>
            <div>
              <p className="text-slate-400 text-sm">Cliente</p>
              <p className="text-white text-lg font-semibold">{mockReportData.clientName}</p>
            </div>
            <div>
              <p className="text-slate-400 text-sm">Distribuidora</p>
              <p className="text-white text-lg font-semibold">{mockReportData.distributorName}</p>
            </div>
            <div>
              <p className="text-slate-400 text-sm">Período</p>
              <p className="text-white text-lg font-semibold">{mockReportData.period}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
            <div className="bg-slate-700/50 p-4 rounded">
              <p className="text-slate-400 text-sm">Economia Total</p>
              <p className="text-green-400 text-xl font-bold">
                R$ {mockReportData.metrics.totalSavings.toLocaleString('pt-BR')}
              </p>
            </div>
            <div className="bg-slate-700/50 p-4 rounded">
              <p className="text-slate-400 text-sm">% Economia</p>
              <p className="text-blue-400 text-xl font-bold">{mockReportData.metrics.avgSavingsPercent.toFixed(1)}%</p>
            </div>
            <div className="bg-slate-700/50 p-4 rounded">
              <p className="text-slate-400 text-sm">ROI</p>
              <p className="text-purple-400 text-xl font-bold">{mockReportData.metrics.roi.toFixed(1)}%</p>
            </div>
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-semibold text-white mb-4">Dados Mensais</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-600">
                    <th className="text-left py-2 px-4 text-slate-300">Mês</th>
                    <th className="text-right py-2 px-4 text-slate-300">Custo Regulado</th>
                    <th className="text-right py-2 px-4 text-slate-300">Custo ACL</th>
                    <th className="text-right py-2 px-4 text-slate-300">Economia</th>
                  </tr>
                </thead>
                <tbody>
                  {mockReportData.monthlyData.map((m, i) => (
                    <tr key={i} className="border-b border-slate-700 hover:bg-slate-700/30">
                      <td className="py-3 px-4 text-white">{m.month}</td>
                      <td className="py-3 px-4 text-right text-slate-300">
                        R$ {m.regulatedCost.toLocaleString('pt-BR')}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-300">
                        R$ {m.aclCost.toLocaleString('pt-BR')}
                      </td>
                      <td className="py-3 px-4 text-right text-green-400 font-semibold">
                        R$ {m.savings.toLocaleString('pt-BR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-white mb-4">Breakdown de Custos</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-400">TUSD Energia:</span>
                  <span className="text-white font-semibold">
                    R$ {mockReportData.breakdown.tusdEnergy.toLocaleString('pt-BR')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">TUSD Demanda:</span>
                  <span className="text-white font-semibold">
                    R$ {mockReportData.breakdown.tusdDemand.toLocaleString('pt-BR')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">TE Energia:</span>
                  <span className="text-white font-semibold">
                    R$ {mockReportData.breakdown.teEnergy.toLocaleString('pt-BR')}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-400">Encargos:</span>
                  <span className="text-white font-semibold">
                    R$ {mockReportData.breakdown.charges.toLocaleString('pt-BR')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Impostos:</span>
                  <span className="text-white font-semibold">
                    R$ {mockReportData.breakdown.taxes.toLocaleString('pt-BR')}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 text-center text-slate-500 text-sm">
          <p>Gerado em {new Date().toLocaleString('pt-BR')}</p>
        </div>
      </div>
    </div>
  );
}
