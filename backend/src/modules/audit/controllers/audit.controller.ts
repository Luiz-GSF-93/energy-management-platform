import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AuditService } from '../services/audit.service';
import { GetAuditLogsDto, ApproveSettlementDto } from '../dtos/audit.dto';

@Controller('audit')
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(private auditService: AuditService) {}

  @Get('logs')
  async getAuditLogs(
    @Request() req: any,
    @Query() filters: GetAuditLogsDto
  ) {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        throw new BadRequestException('Usuário não autenticado');
      }

      console.log('📊 Buscando logs de auditoria para usuário:', userId);
      const organizationId = 'org-expertev-test-001';
      const logs = await this.auditService.getAuditLogs(organizationId, filters);

      return {
        success: true,
        count: logs.length,
        data: logs,
      };
    } catch (exception) {
      console.error('❌ Erro ao buscar logs:', exception);
      return {
        success: false,
        error: String(exception),
      };
    }
  }

  @Get('settlements/:settlementId/history')
  async getSettlementHistory(
    @Request() req: any,
    @Param('settlementId') settlementId: string
  ) {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        throw new BadRequestException('Usuário não autenticado');
      }

      console.log('📅 Buscando histórico da apuração:', settlementId);
      const organizationId = 'org-expertev-test-001';
      const timeline = await this.auditService.getSettlementTimeline(
        organizationId,
        settlementId
      );

      return {
        success: true,
        data: timeline,
      };
    } catch (exception) {
      console.error('❌ Erro ao buscar histórico:', exception);
      return {
        success: false,
        error: String(exception),
      };
    }
  }

  @Get('settlements/:settlementId/adjustments')
  async getAdjustmentHistory(
    @Request() req: any,
    @Param('settlementId') settlementId: string
  ) {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        throw new BadRequestException('Usuário não autenticado');
      }

      console.log('🔧 Buscando ajustes da apuração:', settlementId);
      const organizationId = 'org-expertev-test-001';
      const adjustments = await this.auditService.getAdjustmentHistory(
        organizationId,
        settlementId
      );

      return {
        success: true,
        count: adjustments.length,
        data: adjustments,
      };
    } catch (exception) {
      console.error('❌ Erro ao buscar ajustes:', exception);
      return {
        success: false,
        error: String(exception),
      };
    }
  }

  @Get('settlements/:settlementId/versions')
  async getSettlementVersions(
    @Request() req: any,
    @Param('settlementId') settlementId: string
  ) {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        throw new BadRequestException('Usuário não autenticado');
      }

      console.log('📦 Buscando versões da apuração:', settlementId);
      const versions = await this.auditService.getSettlementVersions(
        settlementId
      );

      return {
        success: true,
        count: versions.length,
        data: versions,
      };
    } catch (exception) {
      console.error('❌ Erro ao buscar versões:', exception);
      return {
        success: false,
        error: String(exception),
      };
    }
  }

  @Post('settlements/:settlementId/approve')
  async approveSetting(
    @Request() req: any,
    @Param('settlementId') settlementId: string,
    @Body() body: ApproveSettlementDto
  ) {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        throw new BadRequestException('Usuário não autenticado');
      }

      console.log('✅ Aprovando apuração:', settlementId, 'Tipo:', body.approvalType);
      const organizationId = 'org-expertev-test-001';
      const result = await this.auditService.approveSetting(
        organizationId,
        userId,
        settlementId,
        body.approvalType,
        body.notes
      );

      return result;
    } catch (exception) {
      console.error('❌ Erro ao aprovar apuração:', exception);
      return {
        success: false,
        settlementId,
        approvedBy: req.user?.sub,
        approvedAt: new Date(),
        message: `Erro ao aprovar: ${String(exception)}`,
      };
    }
  }
}
