import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import * as XLSX from 'xlsx';

export interface ReportData {
  contractNumber: string;
  clientName: string;
  distributorName: string;
  period: string;
  
  metrics: {
    totalSavings: number;
    totalRegulated: number;
    totalAcl: number;
    averageSavingsPercent: number;
    averageMonthlySavings: number;
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
  /**
   * Gera PDF do relatório
   */
  static async generatePDF(data: ReportData, elementId: string): Promise<void> {
    try {
      const element = document.getElementById(elementId);
      if (!element) throw new Error('Elemento não encontrado');

      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgWidth = 210;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
      pdf.save(`Relatorio_${data.contractNumber}_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (error) {
      console.error('Erro ao gerar PDF:', error);
      throw error;
    }
  }

  /**
   * Gera Excel com dados detalhados
   */
  static generateExcel(data: ReportData): void {
    const workbook = XLSX.utils.book_new();

    // Aba 1: Resumo
    const summary = [
      ['RELATÓRIO DE PERFORMANCE ENERGÉTICA'],
      [''],
      ['Contrato', data.contractNumber],
      ['Cliente', data.clientName],
      ['Distribuidora', data.distributorName],
      ['Período', data.period],
      [''],
      ['MÉTRICAS PRINCIPAIS'],
      ['Economia Total (Anual)', `R$ ${data.metrics.totalSavings.toLocaleString('pt-BR')}`],
      ['Custo Regulado (Anual)', `R$ ${data.metrics.totalRegulated.toLocaleString('pt-BR')}`],
      ['Custo Mercado Livre (Anual)', `R$ ${data.metrics.totalAcl.toLocaleString('pt-BR')}`],
      ['% Economia', `${data.metrics.averageSavingsPercent.toFixed(2)}%`],
      ['Economia Mensal (Média)', `R$ ${data.metrics.averageMonthlySavings.toLocaleString('pt-BR')}`],
      ['ROI Anual', `${data.metrics.roi.toFixed(2)}%`],
    ];

    const summarySheet = XLSX.utils.aoa_to_sheet(summary);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Resumo');

    // Aba 2: Dados Mensais
    const monthlySheet = XLSX.utils.json_to_sheet(
      data.monthlyData.map(m => ({
        'Mês': m.month,
        'Regulado (R$)': m.regulatedCost,
        'Mercado Livre (R$)': m.aclCost,
        'Economia (R$)': m.savings,
        '% Economia': ((m.savings / m.regulatedCost) * 100).toFixed(2) + '%',
      }))
    );
    XLSX.utils.book_append_sheet(workbook, monthlySheet, 'Dados Mensais');

    // Aba 3: Breakdown de Custos
    const breakdown = [
      ['DETALHAMENTO DE CUSTOS'],
      [''],
      ['Componente', 'Valor (R$)'],
      ['TUSD Energia', data.breakdown.tusdEnergy],
      ['TUSD Demanda', data.breakdown.tusdDemand],
      ['TE Energia', data.breakdown.teEnergy],
      ['Encargos/CDE', data.breakdown.charges],
      ['Impostos', data.breakdown.taxes],
    ];

    const breakdownSheet = XLSX.utils.aoa_to_sheet(breakdown);
    XLSX.utils.book_append_sheet(workbook, breakdownSheet, 'Breakdown');

    // Salvar
    XLSX.writeFile(workbook, `Relatorio_${data.contractNumber}_${new Date().toISOString().split('T')[0]}.xlsx`);
  }

  /**
   * Gera relatório completo (PDF + Excel)
   */
  static async generateCompleteReport(data: ReportData, elementId?: string): Promise<void> {
    if (elementId) {
      await this.generatePDF(data, elementId);
    }
    this.generateExcel(data);
  }
}
