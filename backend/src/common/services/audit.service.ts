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
}
