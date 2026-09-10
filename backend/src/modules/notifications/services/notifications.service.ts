import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../../services/supabase.service';
import {
  Notification,
  NotificationPreferences,
  Alert,
  NotificationEvent,
} from '../interfaces/notifications.interface';
import { GetNotificationsDto, GetAlertsDto, UpdateNotificationPreferencesDto } from '../dtos/notifications.dto';

@Injectable()
export class NotificationsService {
  constructor(private supabaseService: SupabaseService) {}

  /**
   * Criar notificação
   */
  async createNotification(event: NotificationEvent): Promise<Notification> {
    try {
      const client = this.supabaseService.getClient();

      const { data, error } = await client
        .from('notifications')
        .insert([
          {
            organization_id: event.organizationId,
            user_id: event.userId,
            type: event.type,
            title: event.title,
            message: event.message,
            severity: event.severity,
            related_resource_id: event.relatedResourceId,
            related_resource_type: event.relatedResourceType,
            is_read: false,
            action_url: event.actionUrl,
            created_at: new Date().toISOString(),
          },
        ])
        .select()
        .single();

      if (error) {
        console.error('❌ Erro ao criar notificação:', error);
        throw error;
      }

      return {
        id: data.id,
        organizationId: data.organization_id,
        userId: data.user_id,
        type: data.type,
        title: data.title,
        message: data.message,
        severity: data.severity,
        relatedResourceId: data.related_resource_id,
        relatedResourceType: data.related_resource_type,
        isRead: data.is_read,
        createdAt: new Date(data.created_at),
        readAt: data.read_at ? new Date(data.read_at) : undefined,
        actionUrl: data.action_url,
      };
    } catch (exception) {
      console.error('❌ Exceção ao criar notificação:', exception);
      throw exception;
    }
  }

  /**
   * Obter notificações do usuário
   */
  async getNotifications(
    userId: string,
    organizationId: string,
    filters: GetNotificationsDto
  ): Promise<Notification[]> {
    try {
      const client = this.supabaseService.getClient();

      let query = client
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .eq('organization_id', organizationId);

      if (filters.unreadOnly) {
        query = query.eq('is_read', false);
      }

      if (filters.type) {
        query = query.eq('type', filters.type);
      }

      if (filters.severity) {
        query = query.eq('severity', filters.severity);
      }

      const limit = filters.limit ? parseInt(filters.limit, 10) : 50;

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('❌ Erro ao buscar notificações:', error);
        return [];
      }

      return ((data || []) as any[]).map((n: any) => ({
        id: n.id,
        organizationId: n.organization_id,
        userId: n.user_id,
        type: n.type,
        title: n.title,
        message: n.message,
        severity: n.severity,
        relatedResourceId: n.related_resource_id,
        relatedResourceType: n.related_resource_type,
        isRead: n.is_read,
        createdAt: new Date(n.created_at),
        readAt: n.read_at ? new Date(n.read_at) : undefined,
        actionUrl: n.action_url,
      }));
    } catch (exception) {
      console.error('❌ Exceção ao buscar notificações:', exception);
      return [];
    }
  }

  /**
   * Marcar notificação como lida
   */
  async markAsRead(notificationId: string): Promise<boolean> {
    try {
      const client = this.supabaseService.getClient();

      const { error } = await client
        .from('notifications')
        .update({
          is_read: true,
          read_at: new Date().toISOString(),
        })
        .eq('id', notificationId);

      if (error) {
        console.error('❌ Erro ao marcar como lida:', error);
        return false;
      }

      return true;
    } catch (exception) {
      console.error('❌ Exceção ao marcar como lida:', exception);
      return false;
    }
  }

  /**
   * Obter preferências de notificação
   */
  async getPreferences(
    userId: string,
    organizationId: string
  ): Promise<NotificationPreferences | null> {
    try {
      const client = this.supabaseService.getClient();

      const { data, error } = await client
        .from('notification_preferences')
        .select('*')
        .eq('user_id', userId)
        .eq('organization_id', organizationId)
        .single();

      if (error) {
        console.error('❌ Erro ao buscar preferências:', error);
        return null;
      }

      return {
        id: data.id,
        userId: data.user_id,
        organizationId: data.organization_id,
        emailNotifications: data.email_notifications,
        pushNotifications: data.push_notifications,
        inAppNotifications: data.in_app_notifications,
        notifyOnPendingApproval: data.notify_on_pending_approval,
        notifyOnAnomalyDetected: data.notify_on_anomaly_detected,
        notifyOnApprovalCompleted: data.notify_on_approval_completed,
        notifyOnPublicationReady: data.notify_on_publication_ready,
        notifyOnAdjustmentRequested: data.notify_on_adjustment_requested,
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at),
      };
    } catch (exception) {
      console.error('❌ Exceção ao buscar preferências:', exception);
      return null;
    }
  }

  /**
   * Atualizar preferências de notificação
   */
  async updatePreferences(
    userId: string,
    organizationId: string,
    updates: UpdateNotificationPreferencesDto
  ): Promise<NotificationPreferences | null> {
    try {
      const client = this.supabaseService.getClient();

      const updateData: any = {};
      if (updates.emailNotifications !== undefined)
        updateData.email_notifications = updates.emailNotifications;
      if (updates.pushNotifications !== undefined)
        updateData.push_notifications = updates.pushNotifications;
      if (updates.inAppNotifications !== undefined)
        updateData.in_app_notifications = updates.inAppNotifications;
      if (updates.notifyOnPendingApproval !== undefined)
        updateData.notify_on_pending_approval = updates.notifyOnPendingApproval;
      if (updates.notifyOnAnomalyDetected !== undefined)
        updateData.notify_on_anomaly_detected = updates.notifyOnAnomalyDetected;
      if (updates.notifyOnApprovalCompleted !== undefined)
        updateData.notify_on_approval_completed = updates.notifyOnApprovalCompleted;
      if (updates.notifyOnPublicationReady !== undefined)
        updateData.notify_on_publication_ready = updates.notifyOnPublicationReady;
      if (updates.notifyOnAdjustmentRequested !== undefined)
        updateData.notify_on_adjustment_requested = updates.notifyOnAdjustmentRequested;

      updateData.updated_at = new Date().toISOString();

      const { data, error } = await client
        .from('notification_preferences')
        .update(updateData)
        .eq('user_id', userId)
        .eq('organization_id', organizationId)
        .select()
        .single();

      if (error) {
        console.error('❌ Erro ao atualizar preferências:', error);
        return null;
      }

      return {
        id: data.id,
        userId: data.user_id,
        organizationId: data.organization_id,
        emailNotifications: data.email_notifications,
        pushNotifications: data.push_notifications,
        inAppNotifications: data.in_app_notifications,
        notifyOnPendingApproval: data.notify_on_pending_approval,
        notifyOnAnomalyDetected: data.notify_on_anomaly_detected,
        notifyOnApprovalCompleted: data.notify_on_approval_completed,
        notifyOnPublicationReady: data.notify_on_publication_ready,
        notifyOnAdjustmentRequested: data.notify_on_adjustment_requested,
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at),
      };
    } catch (exception) {
      console.error('❌ Exceção ao atualizar preferências:', exception);
      return null;
    }
  }

  /**
   * Obter alertas
   */
  async getAlerts(
    organizationId: string,
    filters: GetAlertsDto
  ): Promise<Alert[]> {
    try {
      const client = this.supabaseService.getClient();

      let query = client
        .from('alerts')
        .select('*')
        .eq('organization_id', organizationId);

      if (filters.type) {
        query = query.eq('type', filters.type);
      }

      if (filters.severity) {
        query = query.eq('severity', filters.severity);
      }

      if (filters.activeOnly) {
        query = query.eq('is_active', true);
      }

      const { data, error } = await query.order('created_at', {
        ascending: false,
      });

      if (error) {
        console.error('❌ Erro ao buscar alertas:', error);
        return [];
      }

      return ((data || []) as any[]).map((a: any) => ({
        id: a.id,
        organizationId: a.organization_id,
        type: a.type,
        severity: a.severity,
        title: a.title,
        description: a.description,
        count: a.count,
        metadata: typeof a.metadata === 'string' ? JSON.parse(a.metadata) : a.metadata,
        isActive: a.is_active,
        createdAt: new Date(a.created_at),
        resolvedAt: a.resolved_at ? new Date(a.resolved_at) : undefined,
      }));
    } catch (exception) {
      console.error('❌ Exceção ao buscar alertas:', exception);
      return [];
    }
  }

  /**
   * Criar alerta
   */
  async createAlert(
    organizationId: string,
    type: Alert['type'],
    severity: Alert['severity'],
    title: string,
    description: string,
    count: number,
    metadata?: Record<string, any>
  ): Promise<Alert> {
    try {
      const client = this.supabaseService.getClient();

      const { data, error } = await client
        .from('alerts')
        .insert([
          {
            organization_id: organizationId,
            type,
            severity,
            title,
            description,
            count,
            metadata: metadata ? JSON.stringify(metadata) : null,
            is_active: true,
            created_at: new Date().toISOString(),
          },
        ])
        .select()
        .single();

      if (error) {
        console.error('❌ Erro ao criar alerta:', error);
        throw error;
      }

      return {
        id: data.id,
        organizationId: data.organization_id,
        type: data.type,
        severity: data.severity,
        title: data.title,
        description: data.description,
        count: data.count,
        metadata: data.metadata ? JSON.parse(data.metadata) : {},
        isActive: data.is_active,
        createdAt: new Date(data.created_at),
        resolvedAt: data.resolved_at ? new Date(data.resolved_at) : undefined,
      };
    } catch (exception) {
      console.error('❌ Exceção ao criar alerta:', exception);
      throw exception;
    }
  }
}
