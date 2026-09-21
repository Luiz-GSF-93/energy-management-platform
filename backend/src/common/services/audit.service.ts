import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../services/supabase.service';
import { randomUUID } from 'crypto';

@Injectable()
export class AuditService {
  private logger = new Logger('AuditService');

  constructor(private supabaseService: SupabaseService) {}

  async logDelete(params: {
    userId: string;
    organizationId: string;
    resourceType: string;
    resourceId: string;
    before: any;
    after: any;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    const {
      userId,
      organizationId,
      resourceType,
      resourceId,
      before,
      after,
      ipAddress,
      userAgent,
    } = params;

    const auditEntry = {
      id: randomUUID(),
      organization_id: organizationId,
      user_id: userId,
      action: 'DELETE',
      resource_type: resourceType,
      resource_id: resourceId,
      changes: {
        before,
        after,
      },
      ip_address: ipAddress || null,
      user_agent: userAgent || null,
      status: 'success',
      error_message: null,
      created_at: new Date().toISOString(),
    };

    const { error } = await this.supabaseService
      .getClient()
      .from('audit_logs')
      .insert([auditEntry]);

    if (error) {
      this.logger.error(`Failed to log DELETE for ${resourceType} ${resourceId}: ${error.message}`);
      throw new Error(`Audit logging failed: ${error.message}`);
    }

    this.logger.log(`DELETE audited: ${resourceType} ${resourceId} by user ${userId} in org ${organizationId}`);
  }

  async logOrganizationSwitch(params: {
    userId: string;
    fromOrganizationId: string | null;
    toOrganizationId: string;
    fromRoleId?: string | null;
    toRoleId?: string | null;
    auditOrganizationId: string;
    recovery: boolean;
    status: 'success' | 'failed';
    errorMessage?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    try {
      const auditEntry = {
        id: randomUUID(),
        organization_id: params.auditOrganizationId,
        user_id: params.userId,
        action: 'SWITCH_ORGANIZATION',
        resource_type: 'organization_context',
        resource_id: params.toOrganizationId,
        changes: {
          before: {
            organizationId: params.fromOrganizationId,
            roleId: params.fromRoleId ?? null,
          },
          after: {
            organizationId: params.toOrganizationId,
            roleId: params.toRoleId ?? null,
          },
          recovery: params.recovery,
        },
        ip_address: params.ipAddress || null,
        user_agent: params.userAgent || null,
        status: params.status,
        error_message: params.errorMessage || null,
        created_at: new Date().toISOString(),
      };

      const { error } = await this.supabaseService
        .getClient()
        .from('audit_logs')
        .insert(auditEntry);

      if (error) {

        throw new Error('Audit insert failed');
      }

      this.logger.log(
        `[logOrganizationSwitch] Audit ${params.status}`,
      );
    } catch (error) {
      this.logger.error('[logOrganizationSwitch] Audit error');
      throw error;
    }
  }

  async logUserAffiliationChange(params: {
    actorUserId: string;
    organizationId: string;
    targetUserId: string;
    before: 'internal' | 'external';
    after: 'internal' | 'external';
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    const auditEntry = {
      id: randomUUID(),
      organization_id: params.organizationId,
      user_id: params.actorUserId,
      action: 'UPDATE_USER_AFFILIATION',
      resource_type: 'user_profile',
      resource_id: params.targetUserId,
      changes: {
        before: {
          affiliationType: params.before,
        },
        after: {
          affiliationType: params.after,
        },
      },
      ip_address: params.ipAddress || null,
      user_agent: params.userAgent || null,
      status: 'success',
      error_message: null,
      created_at: new Date().toISOString(),
    };

    const { error } = await this.supabaseService
      .getClient()
      .from('audit_logs')
      .insert(auditEntry);

    if (error) {
      this.logger.error(
        `[logUserAffiliationChange] Audit failed for target ${params.targetUserId}`,
      );
      throw new Error('Audit insert failed');
    }

    this.logger.log(
      `[logUserAffiliationChange] Affiliation change audited for target ${params.targetUserId}`,
    );
  }

  async logUserMembershipRoleChange(params: {
    actorUserId: string;
    organizationId: string;
    targetUserId: string;
    membershipId: string;
    beforeRoleId: string;
    afterRoleId: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    const auditEntry = {
      id: randomUUID(),
      organization_id: params.organizationId,
      user_id: params.actorUserId,
      action: 'UPDATE_USER_MEMBERSHIP_ROLE',
      resource_type: 'organization_membership',
      resource_id: params.membershipId,
      changes: {
        before: {
          userId: params.targetUserId,
          roleId: params.beforeRoleId,
        },
        after: {
          userId: params.targetUserId,
          roleId: params.afterRoleId,
        },
      },
      ip_address: params.ipAddress || null,
      user_agent: params.userAgent || null,
      status: 'success',
      error_message: null,
      created_at: new Date().toISOString(),
    };

    const { error } = await this.supabaseService
      .getClient()
      .from('audit_logs')
      .insert(auditEntry);

    if (error) {
      this.logger.error(
        `[logUserMembershipRoleChange] Audit failed for membership ${params.membershipId}`,
      );
      throw new Error('Audit insert failed');
    }

    this.logger.log(
      `[logUserMembershipRoleChange] Role change audited for membership ${params.membershipId}`,
    );
  }


  async logUserMembershipDeactivation(params: {
    actorUserId: string;
    organizationId: string;
    targetUserId: string;
    membershipId: string;
    beforeStatus: 'active';
    afterStatus: 'inactive';
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    const auditEntry = {
      id: randomUUID(),
      organization_id: params.organizationId,
      user_id: params.actorUserId,
      action: 'DEACTIVATE_USER_MEMBERSHIP',
      resource_type: 'organization_membership',
      resource_id: params.membershipId,
      changes: {
        before: {
          userId: params.targetUserId,
          status: params.beforeStatus,
        },
        after: {
          userId: params.targetUserId,
          status: params.afterStatus,
        },
      },
      ip_address: params.ipAddress || null,
      user_agent: params.userAgent || null,
      status: 'success',
      error_message: null,
      created_at: new Date().toISOString(),
    };

    const { error } = await this.supabaseService
      .getClient()
      .from('audit_logs')
      .insert(auditEntry);

    if (error) {
      this.logger.error(
        `[logUserMembershipDeactivation] Audit failed for membership ${params.membershipId}`,
      );
      throw new Error('Audit insert failed');
    }

    this.logger.log(
      `[logUserMembershipDeactivation] Membership deactivation audited for membership ${params.membershipId}`,
    );
  }

}
