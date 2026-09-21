import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { AuditService } from '../../../common/services/audit.service';
import { SupabaseService } from '../../../services/supabase.service';
import { CreateLicenseDto } from '../dto/create-license.dto';

export interface LicenseRecord {
  id: string;
  organization_id: string;
  license_type: string;
  documents_limit: number;
  documents_used: number | null;
  renewal_date: string;
  active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
  status: string | null;
  max_consumer_units: number | null;
  document_management: boolean | null;
  advanced_analytics: boolean | null;
  report_generation: boolean | null;
  free_market_management: boolean | null;
  start_date: string | null;
  end_date: string | null;
}

@Injectable()
export class LicensesService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    dto: CreateLicenseDto,
    auditContext: {
      actorUserId: string;
      organizationId: string;
      ipAddress?: string | null;
      userAgent?: string | null;
    },
  ): Promise<LicenseRecord> {
    const organizationId = auditContext.organizationId;

    if (dto.endDate !== undefined && dto.endDate < dto.startDate) {
      throw new BadRequestException(
        'License end date cannot be before start date',
      );
    }

    const payload: Record<string, unknown> = {
      organization_id: organizationId,
      license_type: dto.licenseType,
      documents_limit: dto.documentsLimit,
      renewal_date: dto.renewalDate,
      start_date: dto.startDate,
      status: 'ACTIVE',
      active: true,
    };

    if (dto.endDate !== undefined) {
      payload.end_date = dto.endDate;
    }
    if (dto.maxConsumerUnits !== undefined) {
      payload.max_consumer_units = dto.maxConsumerUnits;
    }
    if (dto.documentManagement !== undefined) {
      payload.document_management = dto.documentManagement;
    }
    if (dto.advancedAnalytics !== undefined) {
      payload.advanced_analytics = dto.advancedAnalytics;
    }
    if (dto.reportGeneration !== undefined) {
      payload.report_generation = dto.reportGeneration;
    }
    if (dto.freeMarketManagement !== undefined) {
      payload.free_market_management = dto.freeMarketManagement;
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .from('licenses')
      .insert([payload])
      .select('*')
      .single();

    if (error) {
      const constraintEvidence = [
        error.details,
        error.message,
      ]
        .filter((value): value is string => typeof value === 'string')
        .join(' ');

      if (
        error.code === '23P01' &&
        constraintEvidence.includes('licenses_active_validity_excl')
      ) {
        throw new ConflictException(
          'License validity overlaps an existing active license',
        );
      }

      throw new InternalServerErrorException(
        'Unable to create license',
      );
    }

    if (
      !data ||
      typeof data.id !== 'string' ||
      data.id.length === 0 ||
      data.organization_id !== organizationId
    ) {
      throw new InternalServerErrorException(
        'CRITICAL: created license identity could not be confirmed',
      );
    }

    const createdLicense = data as LicenseRecord;

    const compensateCreatedLicense = async (): Promise<void> => {
      const { data: deleted, error: rollbackError } =
        await this.supabaseService
          .getClient()
          .from('licenses')
          .delete()
          .eq('id', createdLicense.id)
          .eq('organization_id', organizationId)
          .select('id, organization_id');

      if (
        rollbackError ||
        !deleted ||
        deleted.length !== 1 ||
        deleted[0]?.id !== createdLicense.id ||
        deleted[0]?.organization_id !== organizationId
      ) {
        throw new InternalServerErrorException(
          'CRITICAL: license creation compensation could not be confirmed',
        );
      }
    };

    if (
      createdLicense.license_type !== dto.licenseType ||
      createdLicense.documents_limit !== dto.documentsLimit ||
      createdLicense.renewal_date !== dto.renewalDate ||
      createdLicense.start_date !== dto.startDate ||
      createdLicense.active !== true ||
      createdLicense.status?.toLowerCase() !== 'active'
    ) {
      await compensateCreatedLicense();

      throw new InternalServerErrorException(
        'Created license integrity violation; creation was reverted',
      );
    }

    try {
      await this.auditService.logLicenseCreation({
        actorUserId: auditContext.actorUserId,
        organizationId,
        licenseId: createdLicense.id,
        after: createdLicense as unknown as Record<string, unknown>,
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
      });
    } catch {
      try {
        await compensateCreatedLicense();
      } catch {
        throw new InternalServerErrorException(
          'CRITICAL: license creation audit failed and compensation could not be confirmed',
        );
      }

      throw new InternalServerErrorException(
        'License creation audit failed; creation was reverted',
      );
    }

    return createdLicense;
  }

  async resolveEffectiveLicense(
    organizationId: string,
    today = new Date().toISOString().slice(0, 10),
  ): Promise<LicenseRecord | null> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('licenses')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('active', true);

    if (error) {
      throw new InternalServerErrorException(
        'Unable to resolve effective license',
      );
    }

    const candidates = ((data ?? []) as LicenseRecord[]).filter((license) => {
      if (license.organization_id !== organizationId) return false;
      if (license.active !== true) return false;
      if (license.status?.toLowerCase() !== 'active') return false;
      if (!license.start_date) return false;
      if (license.start_date > today) return false;
      if (license.end_date !== null && license.end_date < today) return false;

      return true;
    });

    if (candidates.length === 0) {
      return null;
    }

    if (candidates.length !== 1) {
      throw new InternalServerErrorException(
        'Ambiguous effective license state',
      );
    }

    return candidates[0];
  }
}
