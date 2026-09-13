import { Controller, Get, Query, Headers } from '@nestjs/common';
import { DocumentAnalyticsService } from '../services/document-analytics.service';

@Controller('document-processing/analytics')
export class DocumentAnalyticsController {
  constructor(private analyticsService: DocumentAnalyticsService) {}

  @Get('dashboard')
  async getDashboard(@Headers('x-organization-id') organizationId: string) {
    console.log(`📊 Dashboard para organização: ${organizationId}`);
    const stats = await this.analyticsService.getDashboardStats(organizationId);
    
    return {
      success: true,
      data: stats,
      timestamp: new Date(),
    };
  }

  @Get('period')
  async getByPeriod(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Headers('x-organization-id') organizationId: string,
  ) {
    console.log(`📅 Documentos entre ${startDate} e ${endDate}`);
    
    const documents = await this.analyticsService.getDocumentsByPeriod(
      new Date(startDate),
      new Date(endDate),
      organizationId,
    );

    return {
      success: true,
      total: documents.length,
      documents,
      period: { startDate, endDate },
    };
  }

  @Get('distributors')
  async getTopDistributors(@Headers('x-organization-id') organizationId: string) {
    console.log(`🏢 Top distribuidoras para: ${organizationId}`);
    
    const distributors = await this.analyticsService.getTopDistributors(organizationId);

    return {
      success: true,
      total: distributors.length,
      data: distributors,
    };
  }

  @Get('invoice-total')
  async getTotalInvoiceAmount(@Headers('x-organization-id') organizationId: string) {
    console.log(`💰 Total de faturas para: ${organizationId}`);
    
    const total = await this.analyticsService.getTotalInvoiceAmount(organizationId);

    return {
      success: true,
      data: total,
    };
  }

  @Get('status-summary')
  async getStatusSummary(@Headers('x-organization-id') organizationId: string) {
    console.log(`⚠️ Resumo de status para: ${organizationId}`);
    
    const summary = await this.analyticsService.getProcessingStatusSummary(organizationId);

    return {
      success: true,
      data: summary,
    };
  }
}
