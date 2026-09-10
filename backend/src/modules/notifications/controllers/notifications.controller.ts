import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Query,
  Body,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { NotificationsService } from '../services/notifications.service';
import {
  GetNotificationsDto,
  GetAlertsDto,
  UpdateNotificationPreferencesDto,
  MarkNotificationAsReadDto,
} from '../dtos/notifications.dto';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  /**
   * GET /api/v1/notifications
   * Obter notificações do usuário
   */
  @Get()
  async getNotifications(
    @Request() req: any,
    @Query() filters: GetNotificationsDto
  ) {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        throw new BadRequestException('Usuário não autenticado');
      }

      console.log('🔔 Buscando notificações para usuário:', userId);
      const organizationId = 'org-expertev-test-001';

      const notifications = await this.notificationsService.getNotifications(
        userId,
        organizationId,
        filters
      );

      return {
        success: true,
        count: notifications.length,
        data: notifications,
      };
    } catch (exception) {
      console.error('❌ Erro ao buscar notificações:', exception);
      return {
        success: false,
        error: String(exception),
      };
    }
  }

  /**
   * PUT /api/v1/notifications/:notificationId/read
   * Marcar notificação como lida
   */
  @Put(':notificationId/read')
  async markAsRead(
    @Request() req: any,
    @Param('notificationId') notificationId: string
  ) {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        throw new BadRequestException('Usuário não autenticado');
      }

      console.log('✅ Marcando notificação como lida:', notificationId);

      const result = await this.notificationsService.markAsRead(notificationId);

      return {
        success: result,
        notificationId,
        message: result ? 'Notificação marcada como lida' : 'Erro ao marcar como lida',
      };
    } catch (exception) {
      console.error('❌ Erro ao marcar como lida:', exception);
      return {
        success: false,
        error: String(exception),
      };
    }
  }

  /**
   * GET /api/v1/notifications/preferences
   * Obter preferências de notificação
   */
  @Get('preferences')
  async getPreferences(@Request() req: any) {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        throw new BadRequestException('Usuário não autenticado');
      }

      console.log('⚙️ Buscando preferências de notificação...');
      const organizationId = 'org-expertev-test-001';

      const preferences = await this.notificationsService.getPreferences(
        userId,
        organizationId
      );

      return {
        success: true,
        data: preferences,
      };
    } catch (exception) {
      console.error('❌ Erro ao buscar preferências:', exception);
      return {
        success: false,
        error: String(exception),
      };
    }
  }

  /**
   * PUT /api/v1/notifications/preferences
   * Atualizar preferências de notificação
   */
  @Put('preferences')
  async updatePreferences(
    @Request() req: any,
    @Body() body: UpdateNotificationPreferencesDto
  ) {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        throw new BadRequestException('Usuário não autenticado');
      }

      console.log('🔧 Atualizando preferências de notificação...');
      const organizationId = 'org-expertev-test-001';

      const preferences = await this.notificationsService.updatePreferences(
        userId,
        organizationId,
        body
      );

      return {
        success: true,
        data: preferences,
        message: 'Preferências atualizadas com sucesso',
      };
    } catch (exception) {
      console.error('❌ Erro ao atualizar preferências:', exception);
      return {
        success: false,
        error: String(exception),
      };
    }
  }

  /**
   * GET /api/v1/notifications/alerts
   * Obter alertas da organização
   */
  @Get('alerts')
  async getAlerts(
    @Request() req: any,
    @Query() filters: GetAlertsDto
  ) {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        throw new BadRequestException('Usuário não autenticado');
      }

      console.log('⚠️ Buscando alertas...');
      const organizationId = 'org-expertev-test-001';

      const alerts = await this.notificationsService.getAlerts(
        organizationId,
        filters
      );

      return {
        success: true,
        count: alerts.length,
        data: alerts,
      };
    } catch (exception) {
      console.error('❌ Erro ao buscar alertas:', exception);
      return {
        success: false,
        error: String(exception),
      };
    }
  }
}
