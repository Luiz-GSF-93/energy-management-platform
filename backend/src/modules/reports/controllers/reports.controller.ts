import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ReportsService } from '../services/reports.service';
import {
  GetSummaryReportDto,
  GetSettlementReportDto,
  GetAnomalyReportDto,
  GetApprovalMetricsDto,
  GetSavingsComparisonDto,
  ExportReportDto,
} from '../dtos/reports.dto';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  /**
   * GET /api/v1/reports/summary
   * Resumo financeiro geral
   */
  @Get('summary')
  async getSummaryReport(
    @Request() req: any,
    @Query() filters: GetSummaryReportDto
  ) {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        throw new BadRequestException('Usuário não autenticado');
      }

      console.log('📊 Gerando resumo financeiro...');
      const organizationId = 'org-expertev-test-001';

      const report = await this.reportsService.getSummaryReport(
        organizationId,
        filters
      );

      return {
        success: true,
        data: report,
      };
    } catch (exception) {
      console.error('❌ Erro ao gerar resumo:', exception);
      return {
        success: false,
        error: String(exception),
      };
    }
  }

  /**
   * GET /api/v1/reports/settlements/:period
   * Relatório de apurações por período
   */
  @Get('settlements')
  async getSettlementReport(
    @Request() req: any,
    @Query() filters: GetSettlementReportDto
  ) {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        throw new BadRequestException('Usuário não autenticado');
      }

      console.log('📈 Gerando relatório de apurações...');
      const organizationId = 'org-expertev-test-001';

      if (!filters.period) {
        throw new BadRequestException('Período é obrigatório');
      }

      const report = await this.reportsService.getSettlementReport(
        organizationId,
        filters
      );

      return {
        success: true,
        data: report,
      };
    } catch (exception) {
      console.error('❌ Erro ao gerar relatório:', exception);
      return {
        success: false,
        error: String(exception),
      };
    }
  }

  /**
   * GET /api/v1/reports/anomalies
   * Relatório de anomalias detectadas
   */
  @Get('anomalies')
  async getAnomalyReport(
    @Request() req: any,
    @Query() filters: GetAnomalyReportDto
  ) {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        throw new BadRequestException('Usuário não autenticado');
      }

      console.log('⚠️ Gerando relatório de anomalias...');
      const organizationId = 'org-expertev-test-001';

      const report = await this.reportsService.getAnomalyReport(
        organizationId,
        filters
      );

      return {
        success: true,
        data: report,
      };
    } catch (exception) {
      console.error('❌ Erro ao gerar relatório de anomalias:', exception);
      return {
        success: false,
        error: String(exception),
      };
    }
  }

  /**
   * GET /api/v1/reports/approvals
   * Métricas de aprovação
   */
  @Get('approvals')
  async getApprovalMetrics(
    @Request() req: any,
    @Query() filters: GetApprovalMetricsDto
  ) {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        throw new BadRequestException('Usuário não autenticado');
      }

      console.log('✅ Gerando métricas de aprovação...');
      const organizationId = 'org-expertev-test-001';

      const metrics = await this.reportsService.getApprovalMetrics(
        organizationId,
        filters
      );

      return {
        success: true,
        data: metrics,
      };
    } catch (exception) {
      console.error('❌ Erro ao gerar métricas:', exception);
      return {
        success: false,
        error: String(exception),
      };
    }
  }

  /**
   * GET /api/v1/reports/savings
   * Comparativo de economias
   */
  @Get('savings')
  async getSavingsComparison(
    @Request() req: any,
    @Query() filters: GetSavingsComparisonDto
  ) {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        throw new BadRequestException('Usuário não autenticado');
      }

      console.log('💰 Gerando comparativo de economias...');
      const organizationId = 'org-expertev-test-001';

      if (!filters.period) {
        throw new BadRequestException('Período é obrigatório');
      }

      const report = await this.reportsService.getSavingsComparison(
        organizationId,
        filters
      );

      return {
        success: true,
        data: report,
      };
    } catch (exception) {
      console.error('❌ Erro ao gerar comparativo:', exception);
      return {
        success: false,
        error: String(exception),
      };
    }
  }

  /**
   * POST /api/v1/reports/export
   * Exportar relatório em diferentes formatos
   */
  @Post('export')
  async exportReport(
    @Request() req: any,
    @Body() body: ExportReportDto
  ) {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        throw new BadRequestException('Usuário não autenticado');
      }

      console.log(`📥 Exportando relatório em formato ${body.format}...`);
      const organizationId = 'org-expertev-test-001';

      // TODO: Implementar exportação real (PDF, Excel, CSV)
      // Por enquanto, retornar dados para download

      return {
        success: true,
        message: `Exportação em ${body.format} será implementada`,
        reportType: body.reportType,
        format: body.format,
        timestamp: new Date(),
      };
    } catch (exception) {
      console.error('❌ Erro ao exportar:', exception);
      return {
        success: false,
        error: String(exception),
      };
    }
  }
}
