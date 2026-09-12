export interface ReportData {
  contractNumber: string;
  clientName: string;
  distributorName: string;
  period: string;
  metrics: {
    totalSavings: number;
    totalRegulated: number;
    totalAcl: number;
    avgSavingsPercent: number;
    avgMonthlySavings: number;
    roi: number;
  };
  monthlyData: Array<{
    month: string;
    regulatedCost: number;
    aclCost: number;
    savings: number;
  }>;
  breakdown: {
    tusdEnergy: number;
    tusdDemand: number;
    teEnergy: number;
    charges: number;
    taxes: number;
  };
}

export class ReportService {
  static async generatePDF(data: ReportData): Promise<void> {
    console.log('📄 Generating PDF...', data);
    const content = this.formatReportContent(data);
    const filename = `relatorio-${data.contractNumber}-${new Date().toISOString().split('T')[0]}.txt`;
    this.downloadText(content, filename);
  }

  static async generateExcel(data: ReportData): Promise<void> {
    console.log('📊 Generating Excel...', data);
    const csv = this.formatReportAsCSV(data);
    const filename = `relatorio-${data.contractNumber}-${new Date().toISOString().split('T')[0]}.csv`;
    this.downloadText(csv, filename);
  }

  static async generateCompleteReport(data: ReportData): Promise<void> {
    console.log('📋 Generating complete report...', data);
    await this.generatePDF(data);
    await this.generateExcel(data);
  }

  private static formatReportContent(data: ReportData): string {
    return `RELATÓRIO DE PERFORMANCE ENERGÉTICA
====================================
Contrato: ${data.contractNumber}
Cliente: ${data.clientName}
Distribuidora: ${data.distributorName}
Período: ${data.period}

MÉTRICAS PRINCIPAIS
-------------------
Economia Total: R$ ${data.metrics.totalSavings.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
Custos Regulado: R$ ${data.metrics.totalRegulated.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
Custos ACL: R$ ${data.metrics.totalAcl.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
% Economia: ${data.metrics.avgSavingsPercent.toFixed(2)}%
Economia Mensal Média: R$ ${data.metrics.avgMonthlySavings.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
ROI: ${data.metrics.roi.toFixed(2)}%

BREAKDOWN DE CUSTOS
-------------------
TUSD Energia: R$ ${data.breakdown.tusdEnergy.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
TUSD Demanda: R$ ${data.breakdown.tusdDemand.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
TE Energia: R$ ${data.breakdown.teEnergy.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
Encargos: R$ ${data.breakdown.charges.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
Impostos: R$ ${data.breakdown.taxes.toLocaleString('pt-BR', {minimumFractionDigits: 2})}

DADOS MENSAIS
-------------
${data.monthlyData.map(m => `${m.month}: Regulado R$ ${m.regulatedCost.toLocaleString('pt-BR', {minimumFractionDigits: 2})} | ACL R$ ${m.aclCost.toLocaleString('pt-BR', {minimumFractionDigits: 2})} | Economia R$ ${m.savings.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`).join('\n')}

Gerado em: ${new Date().toLocaleString('pt-BR')}`;
  }

  private static formatReportAsCSV(data: ReportData): string {
    const headers = ['Mês', 'Custo Regulado', 'Custo ACL', 'Economia'];
    const rows = data.monthlyData.map(m => [m.month, m.regulatedCost, m.aclCost, m.savings]);
    return [headers, ...rows].map(r => r.join(',')).join('\n');
  }

  private static downloadText(content: string, filename: string): void {
    if (typeof window === 'undefined') return;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
