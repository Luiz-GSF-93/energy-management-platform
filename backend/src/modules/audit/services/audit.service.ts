import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../../services/supabase.service';
import {
  AuditLog,
  AuditSettlementTimeline,
  AuditTimelineEntry,
  AdjustmentRecord,
  SettlementVersion,
  ApprovalResponse,
} from '../interfaces/audit.interface';
import { GetAuditLogsDto } from '../dtos/audit.dto';

@Injectable()
export class AuditService {
  constructor(private supabaseService: SupabaseService) {}

  /**
   * Registrar uma ação no audit_logs
   */
  async logAction(
    organizationId: string,
    userId: string,
    resourceType: string,
    resourceId: string,
    action: string,
    changes?: Record<string, any>,
    ipAddress?: string,
    userAgent?: string
  ): Promise<AuditLog> {
    try {
      const client = this.supabaseService.getClient();

      const { data, error } = await client
        .from('audit_logs')
        .insert([
          {
            organization_id: organizationId,
            user_id: userId,
            resource_type: resourceType,
            resource_id: resourceId,
            action,
            changes: changes ? JSON.stringify(changes) : null,
            ip_address: ipAddress,
            user_agent: userAgent,
            timestamp: new Date().toISOString(),
          },
        ])
        .select()
        .single();

      if (error) {
        console.error('❌ Erro ao registrar auditoria:', error);
        throw error;
      }

      return {
        id: data.id,
        organizationId: data.organization_id,
        userId: data.user_id,
        resourceType: data.resource_type,
        resourceId: data.resource_id,
        action: data.action,
        changes: data.changes ? JSON.parse(data.changes) : undefined,
        timestamp: new Date(data.timestamp),
        ipAddress: data.ip_address,
        userAgent: data.user_agent,
        createdAt: new Date(data.created_at),
      };
    } catch (exception) {
      console.error('❌ Exceção ao registrar auditoria:', exception);
      throw exception;
    }
  }

  /**
   * Obter logs de auditoria filtrados
   */
  async getAuditLogs(
    organizationId: string,
    filters: GetAuditLogsDto
  ): Promise<AuditLog[]> {
    try {
      const client = this.supabaseService.getClient();

      let query = client
        .from('audit_logs')
        .select('*')
        .eq('organization_id', organizationId);

      if (filters.resourceType) {
        query = query.eq('resource_type', filters.resourceType);
      }

      if (filters.action) {
        query = query.eq('action', filters.action);
      }

      if (filters.userId) {
        query = query.eq('user_id', filters.userId);
      }

      if (filters.resourceId) {
        query = query.eq('resource_id', filters.resourceId);
      }

      if (filters.startDate) {
        query = query.gte('timestamp', filters.startDate);
      }

      if (filters.endDate) {
        query = query.lte('timestamp', filters.endDate);
      }

      const { data, error } = await query
        .order('timestamp', { ascending: false })
        .limit(100);

      if (error) {
        console.error('❌ Erro ao buscar logs:', error);
        return [];
      }

      return (data || []).map((log: any) => ({
        id: log.id,
        organizationId: log.organization_id,
        userId: log.user_id,
        resourceType: log.resource_type,
        resourceId: log.resource_id,
        action: log.action,
        changes: log.changes ? JSON.parse(log.changes) : undefined,
        timestamp: new Date(log.timestamp),
        ipAddress: log.ip_address,
        userAgent: log.user_agent,
        createdAt: new Date(log.created_at),
      }));
    } catch (exception) {
      console.error('❌ Exceção ao buscar logs:', exception);
      return [];
    }
  }

  /**
   * Obter histórico completo de uma apuração (timeline)
   */
  async getSettlementTimeline(
    organizationId: string,
    settlementId: string
  ): Promise<AuditSettlementTimeline> {
    try {
      const client = this.supabaseService.getClient();

      // 1. Obter dados da apuração
      const { data: settlement, error: settlementError } = await client
        .from('monthly_energy_settlements')
        .select('*')
        .eq('id', settlementId)
        .single();

      if (settlementError || !settlement) {
        throw new Error('Apuração não encontrada');
      }

      // 2. Obter logs de auditoria
      const { data: auditLogs, error: auditError } = await client
        .from('audit_logs')
        .select('*')
        .eq('resource_id', settlementId)
        .eq('organization_id', organizationId)
        .order('timestamp', { ascending: true });

      if (auditError) {
        throw auditError;
      }

      // 3. Obter histórico de ajustes
      const { data: adjustments, error: adjustmentsError } = await client
        .from('adjustment_history')
        .select('*')
        .eq('settlement_id', settlementId)
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: true });

      if (adjustmentsError) {
        throw adjustmentsError;
      }

      // 4. Obter versões
      const { data: versions, error: versionsError } = await client
        .from('settlement_versions')
        .select('*')
        .eq('settlement_id', settlementId)
        .order('created_at', { ascending: true });

      if (versionsError) {
        throw versionsError;
      }

      // 5. Construir timeline
      const timeline: AuditTimelineEntry[] = [];

      // Adicionar evento de criação
      timeline.push({
        timestamp: new Date(settlement.created_at),
        type: 'created',
        actor: settlement.created_by || 'system',
        description: `Apuração criada para ${settlement.month}`,
        metadata: { month: settlement.month },
      });

      // Adicionar eventos de validação
      if (settlement.validation_date) {
        timeline.push({
          timestamp: new Date(settlement.validation_date),
          type: 'validated',
          actor: 'system',
          description: `Validação realizada - Status: ${settlement.validation_status}`,
          metadata: {
            validationStatus: settlement.validation_status,
            validationErrors: settlement.validation_errors,
          },
        });
      }

      // Adicionar ajustes
      (adjustments || []).forEach((adj: any) => {
        timeline.push({
          timestamp: new Date(adj.created_at),
          type: 'adjusted',
          actor: adj.created_by,
          description: `${adj.adjustment_type}: ${adj.original_value} → ${adj.adjusted_value}`,
          changes: {
            adjustmentType: adj.adjustment_type,
            originalValue: adj.original_value,
            adjustedValue: adj.adjusted_value,
            reason: adj.reason,
          },
          metadata: {
            status: adj.status,
            approvedBy: adj.approved_by,
            approvalDate: adj.approval_date,
          },
        });
      });

      // Adicionar aprovação
      if (settlement.approved_at) {
        timeline.push({
          timestamp: new Date(settlement.approved_at),
          type: 'approved',
          actor: settlement.approved_by || 'system',
          description: 'Apuração aprovada',
        });
      }

      // Adicionar publicação
      if (settlement.published_at) {
        timeline.push({
          timestamp: new Date(settlement.published_at),
          type: 'published',
          actor: 'system',
          description: 'Apuração publicada',
        });
      }

      // Adicionar versões
      (versions || []).forEach((v: any) => {
        timeline.push({
          timestamp: new Date(v.created_at),
          type: 'versioned',
          actor: v.created_by || 'system',
          description: `Versão ${v.version_number} criada - ${v.reason || 'Sem motivo'}`,
          metadata: { versionNumber: v.version_number },
        });
      });

      return {
        settlementId,
        month: new Date(settlement.month),
        status: settlement.status,
        validationStatus: settlement.validation_status,
        timeline: timeline.sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        ),
        summary: {
          created: new Date(settlement.created_at),
          lastModified: new Date(settlement.updated_at),
          approvedBy: settlement.approved_by,
          approvedAt: settlement.approved_at ? new Date(settlement.approved_at) : undefined,
          totalAdjustments: adjustments?.length || 0,
          totalVersions: versions?.length || 0,
        },
      };
    } catch (exception) {
      console.error('❌ Exceção ao obter timeline:', exception);
      throw exception;
    }
  }

  /**
   * Obter histórico de ajustes de uma apuração
   */
  async getAdjustmentHistory(
    organizationId: string,
    settlementId: string
  ): Promise<AdjustmentRecord[]> {
    try {
      const client = this.supabaseService.getClient();

      const { data, error } = await client
        .from('adjustment_history')
        .select('*')
        .eq('settlement_id', settlementId)
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('❌ Erro ao buscar ajustes:', error);
        return [];
      }

      return (data || []).map((adj: any) => ({
        id: adj.id,
        settlementId: adj.settlement_id,
        energyContractId: adj.energy_contract_id,
        adjustmentType: adj.adjustment_type,
        originalValue: adj.original_value,
        adjustedValue: adj.adjusted_value,
        adjustmentAmount: adj.adjustment_amount,
        reason: adj.reason,
        justification: adj.justification,
        approvedBy: adj.approved_by,
        approvalDate: adj.approval_date ? new Date(adj.approval_date) : undefined,
        status: adj.status,
        createdBy: adj.created_by,
        createdAt: new Date(adj.created_at),
        updatedAt: new Date(adj.updated_at),
      }));
    } catch (exception) {
      console.error('❌ Exceção ao buscar ajustes:', exception);
      return [];
    }
  }

  /**
   * Obter versões de uma apuração
   */
  async getSettlementVersions(
    settlementId: string
  ): Promise<SettlementVersion[]> {
    try {
      const client = this.supabaseService.getClient();

      const { data, error } = await client
        .from('settlement_versions')
        .select('*')
        .eq('settlement_id', settlementId)
        .order('version_number', { ascending: true });

      if (error) {
        console.error('❌ Erro ao buscar versões:', error);
        return [];
      }

      return (data || []).map((v: any) => ({
        id: v.id,
        settlementId: v.settlement_id,
        versionNumber: v.version_number,
        data: typeof v.data === 'string' ? JSON.parse(v.data) : v.data,
        reason: v.reason,
        createdBy: v.created_by,
        createdAt: v.created_at ? new Date(v.created_at) : undefined,
      }));
    } catch (exception) {
      console.error('❌ Exceção ao buscar versões:', exception);
      return [];
    }
  }

  /**
   * Aprovar uma apuração
   */
  async approveSetting(
    organizationId: string,
    userId: string,
    settlementId: string,
    approvalType: 'validation' | 'adjustment' | 'publication',
    notes?: string
  ): Promise<ApprovalResponse> {
    try {
      const client = this.supabaseService.getClient();

      // 1. Atualizar settlement com approved_by e approved_at
      const updateData: any = {
        approved_by: userId,
        approved_at: new Date().toISOString(),
      };

      if (approvalType === 'publication') {
        updateData.published_at = new Date().toISOString();
        updateData.status = 'published';
      }

      const { error: updateError } = await client
        .from('monthly_energy_settlements')
        .update(updateData)
        .eq('id', settlementId);

      if (updateError) {
        throw updateError;
      }

      // 2. Registrar no audit_logs
      await this.logAction(
        organizationId,
        userId,
        'monthly_energy_settlements',
        settlementId,
        `approve_${approvalType}`,
        { approvalType, notes },
      );

      return {
        success: true,
        settlementId,
        approvedBy: userId,
        approvedAt: new Date(),
        message: `Apuração aprovada como ${approvalType}`,
      };
    } catch (exception) {
      console.error('❌ Exceção ao aprovar apuração:', exception);
      return {
        success: false,
        settlementId,
        approvedBy: userId,
        approvedAt: new Date(),
        message: `Erro ao aprovar: ${String(exception)}`,
      };
    }
  }
}
