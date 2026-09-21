import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../../common/services/audit.service';
import { SupabaseService } from '../../../services/supabase.service';
import { CreateLicenseDto } from '../dto/create-license.dto';
import { UpdateLicenseDto } from '../dto/update-license.dto';

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

  async update(
    licenseId: string,
    dto: UpdateLicenseDto,
    auditContext: {
      actorUserId: string;
      organizationId: string;
      ipAddress?: string | null;
      userAgent?: string | null;
    },
  ): Promise<LicenseRecord> {
    const client = this.supabaseService.getClient();
    const organizationId = auditContext.organizationId;

    if (Object.keys(dto).length === 0) {
      throw new BadRequestException(
        'License update requires at least one field',
      );
    }

    const { data: licenses, error: loadError } = await client
      .from('licenses')
      .select('*')
      .eq('id', licenseId)
      .eq('organization_id', organizationId);

    if (loadError) {
      throw new InternalServerErrorException('Unable to load license');
    }

    if (!licenses || licenses.length === 0) {
      throw new NotFoundException('License not found');
    }

    if (licenses.length !== 1) {
      throw new InternalServerErrorException(
        'Data integrity error: multiple licenses found',
      );
    }

    const before = licenses[0] as LicenseRecord;

    if (
      before.id !== licenseId ||
      before.organization_id !== organizationId
    ) {
      throw new InternalServerErrorException(
        'Data integrity error: invalid license identity',
      );
    }

    const nextStatus = dto.status ?? before.status?.toLowerCase();

    if (
      nextStatus !== 'active' &&
      nextStatus !== 'suspended' &&
      nextStatus !== 'expired' &&
      nextStatus !== 'cancelled'
    ) {
      throw new BadRequestException('License has invalid lifecycle state');
    }

    const nextStartDate =
      dto.startDate !== undefined ? dto.startDate : before.start_date;
    const nextEndDate =
      dto.endDate !== undefined ? dto.endDate : before.end_date;

    if (nextStatus === 'active' && !nextStartDate) {
      throw new BadRequestException(
        'Active license requires a start date',
      );
    }

    if (
      nextStartDate !== null &&
      nextEndDate !== null &&
      nextEndDate < nextStartDate
    ) {
      throw new BadRequestException(
        'License end date cannot be before start date',
      );
    }

    const payload: Record<string, unknown> = {};

    if (dto.licenseType !== undefined) {
      payload.license_type = dto.licenseType;
    }
    if (dto.documentsLimit !== undefined) {
      payload.documents_limit = dto.documentsLimit;
    }
    if (dto.renewalDate !== undefined) {
      payload.renewal_date = dto.renewalDate;
    }
    if (dto.startDate !== undefined) {
      payload.start_date = dto.startDate;
    }
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

    if (dto.status !== undefined) {
      payload.status = dto.status.toUpperCase();
      payload.active = dto.status === 'active';
    }

    const effectivePayload = Object.fromEntries(
      Object.entries(payload).filter(([key, value]) => {
        const current = before[key as keyof LicenseRecord];
        return current !== value;
      }),
    );

    if (Object.keys(effectivePayload).length === 0) {
      return before;
    }

    effectivePayload.updated_at = new Date().toISOString();

    let updateQuery = client
      .from('licenses')
      .update(effectivePayload)
      .eq('id', licenseId)
      .eq('organization_id', organizationId);

    updateQuery =
      before.updated_at === null
        ? updateQuery.is('updated_at', null)
        : updateQuery.eq('updated_at', before.updated_at);

    const { data: updatedRows, error: updateError } =
      await updateQuery.select('*');

    if (updateError) {
      const evidence = [updateError.details, updateError.message]
        .filter((value): value is string => typeof value === 'string')
        .join(' ');

      if (
        updateError.code === '23P01' &&
        evidence.includes('licenses_active_validity_excl')
      ) {
        throw new ConflictException(
          'License validity overlaps an existing active license',
        );
      }

      throw new InternalServerErrorException('Unable to update license');
    }

    if (!updatedRows || updatedRows.length !== 1) {
      throw new ConflictException(
        'License changed concurrently; reload before updating',
      );
    }

    const after = updatedRows[0] as LicenseRecord;

    if (
      after.id !== licenseId ||
      after.organization_id !== organizationId
    ) {
      throw new InternalServerErrorException(
        'Data integrity error: invalid updated license identity',
      );
    }

    const rollbackPayload: Record<string, unknown> = {};

    for (const key of Object.keys(effectivePayload)) {
      if (key === 'updated_at') continue;
      rollbackPayload[key] = before[key as keyof LicenseRecord];
    }

    rollbackPayload.updated_at = before.updated_at;

    const compensateUpdatedLicense = async (): Promise<void> => {
      let rollbackQuery = client
        .from('licenses')
        .update(rollbackPayload)
        .eq('id', licenseId)
        .eq('organization_id', organizationId);

      rollbackQuery =
        after.updated_at === null
          ? rollbackQuery.is('updated_at', null)
          : rollbackQuery.eq('updated_at', after.updated_at);

      const { data: revertedRows, error: rollbackError } =
        await rollbackQuery.select('*');

      if (
        rollbackError ||
        !revertedRows ||
        revertedRows.length !== 1 ||
        revertedRows[0]?.id !== licenseId ||
        revertedRows[0]?.organization_id !== organizationId
      ) {
        throw new InternalServerErrorException(
          'CRITICAL: license update compensation could not be confirmed',
        );
      }
    };

    for (const [key, value] of Object.entries(effectivePayload)) {
      if (key === 'updated_at') continue;

      if (after[key as keyof LicenseRecord] !== value) {
        await compensateUpdatedLicense();

        throw new InternalServerErrorException(
          'License update integrity violation; update was reverted',
        );
      }
    }

    try {
      await this.auditService.logLicenseUpdate({
        actorUserId: auditContext.actorUserId,
        organizationId,
        licenseId,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
      });
    } catch {
      try {
        await compensateUpdatedLicense();
      } catch {
        throw new InternalServerErrorException(
          'CRITICAL: license update audit failed and rollback could not be confirmed',
        );
      }

      throw new InternalServerErrorException(
        'License update audit failed; update was reverted',
      );
    }

    return after;
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
