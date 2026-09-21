import {
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { CreateLicenseDto } from '../dto/create-license.dto';
import { LicenseRecord, LicensesService } from './licenses.service';

const dto: CreateLicenseDto = {
  licenseType: 'foundation',
  documentsLimit: 100,
  renewalDate: '2027-01-01',
  startDate: '2026-09-21',
};

const context = {
  actorUserId: 'user-1',
  organizationId: 'org-1',
  ipAddress: '203.0.113.10',
  userAgent: 'F1.4i.2-test',
};

const created: LicenseRecord = {
  id: 'license-1',
  organization_id: 'org-1',
  license_type: 'foundation',
  documents_limit: 100,
  documents_used: 0,
  renewal_date: '2027-01-01',
  active: true,
  created_at: '2026-09-21T20:00:00',
  updated_at: '2026-09-21T20:00:00',
  status: 'ACTIVE',
  max_consumer_units: 10,
  document_management: true,
  advanced_analytics: false,
  report_generation: false,
  free_market_management: false,
  start_date: '2026-09-21',
  end_date: null,
};

function createHarness(options: {
  insertData?: LicenseRecord | null;
  insertError?: any;
  auditReject?: boolean;
  rollbackData?: Array<{ id: string; organization_id: string }> | null;
  rollbackError?: any;
} = {}) {
  const insertData =
    options.insertData === undefined ? created : options.insertData;

  const single = jest.fn().mockResolvedValue({
    data: insertData,
    error: options.insertError ?? null,
  });

  const insertSelect = jest.fn(() => ({ single }));
  const insert = jest.fn(() => ({ select: insertSelect }));

  const rollbackSelect = jest.fn().mockResolvedValue({
    data:
      options.rollbackData === undefined
        ? [{ id: created.id, organization_id: created.organization_id }]
        : options.rollbackData,
    error: options.rollbackError ?? null,
  });

  const rollbackEqOrganization = jest.fn(() => ({
    select: rollbackSelect,
  }));

  const rollbackEqId = jest.fn(() => ({
    eq: rollbackEqOrganization,
  }));

  const deleteLicense = jest.fn(() => ({
    eq: rollbackEqId,
  }));

  const from = jest.fn((table: string) => {
    if (table !== 'licenses') {
      throw new Error(`Unexpected table: ${table}`);
    }

    return {
      insert,
      delete: deleteLicense,
    };
  });

  const getClient = jest.fn(() => ({ from }));

  const supabaseService: any = {
    getClient,
  };

  const logLicenseCreation = options.auditReject
    ? jest.fn().mockRejectedValue(new Error('audit failure'))
    : jest.fn().mockResolvedValue(undefined);

  const auditService: any = {
    logLicenseCreation,
  };

  const service = new LicensesService(
    supabaseService,
    auditService,
  );

  return {
    service,
    getClient,
    insert,
    insertSelect,
    single,
    deleteLicense,
    rollbackEqId,
    rollbackEqOrganization,
    rollbackSelect,
    logLicenseCreation,
  };
}

describe('LicensesService.create — F1.4i.2', () => {
  it('rejects an end date before the start date before persistence', async () => {
    const h = createHarness();

    await expect(
      h.service.create(
        {
          ...dto,
          startDate: '2026-09-21',
          endDate: '2026-09-20',
        },
        context,
      ),
    ).rejects.toThrow(
      'License end date cannot be before start date',
    );

    expect(h.getClient).not.toHaveBeenCalled();
    expect(h.logLicenseCreation).not.toHaveBeenCalled();
  });

  it('creates an active license in the validated organization and audits it', async () => {
    const h = createHarness();

    await expect(
      h.service.create(dto, context),
    ).resolves.toEqual(created);

    expect(h.insert).toHaveBeenCalledTimes(1);

    const payload = h.insert.mock.calls[0][0];

    expect(payload).toEqual([
      {
        organization_id: context.organizationId,
        license_type: dto.licenseType,
        documents_limit: dto.documentsLimit,
        renewal_date: dto.renewalDate,
        start_date: dto.startDate,
        status: 'ACTIVE',
        active: true,
      },
    ]);

    expect(h.logLicenseCreation).toHaveBeenCalledWith({
      actorUserId: context.actorUserId,
      organizationId: context.organizationId,
      licenseId: created.id,
      after: created,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    expect(h.deleteLicense).not.toHaveBeenCalled();
  });

  it('persists explicitly supplied optional configuration', async () => {
    const h = createHarness();

    const configured: CreateLicenseDto = {
      ...dto,
      endDate: '2027-09-20',
      maxConsumerUnits: 25,
      documentManagement: false,
      advancedAnalytics: true,
      reportGeneration: true,
      freeMarketManagement: true,
    };

    await h.service.create(configured, context);

    expect(h.insert.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        end_date: configured.endDate,
        max_consumer_units: configured.maxConsumerUnits,
        document_management: false,
        advanced_analytics: true,
        report_generation: true,
        free_market_management: true,
      }),
    ]);
  });

  it('maps the known active-validity exclusion conflict', async () => {
    const h = createHarness({
      insertData: null,
      insertError: {
        code: '23P01',
        details: 'conflicting key violates exclusion constraint',
        message:
          'conflicting key violates exclusion constraint "licenses_active_validity_excl"',
      },
    });

    await expect(
      h.service.create(dto, context),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(h.logLicenseCreation).not.toHaveBeenCalled();
    expect(h.deleteLicense).not.toHaveBeenCalled();
  });

  it('does not misclassify another database error as a license conflict', async () => {
    const h = createHarness({
      insertData: null,
      insertError: {
        code: '23514',
        message: 'check constraint violation',
      },
    });

    await expect(
      h.service.create(dto, context),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(h.logLicenseCreation).not.toHaveBeenCalled();
  });

  it('fails critically without broad deletion when created identity cannot be confirmed', async () => {
    const h = createHarness({
      insertData: {
        ...created,
        organization_id: 'org-2',
      },
    });

    await expect(
      h.service.create(dto, context),
    ).rejects.toThrow(
      'CRITICAL: created license identity could not be confirmed',
    );

    expect(h.logLicenseCreation).not.toHaveBeenCalled();
    expect(h.deleteLicense).not.toHaveBeenCalled();
  });

  it('reverts the exact created license when returned content violates integrity', async () => {
    const h = createHarness({
      insertData: {
        ...created,
        license_type: 'unexpected',
      },
    });

    await expect(
      h.service.create(dto, context),
    ).rejects.toThrow(
      'Created license integrity violation; creation was reverted',
    );

    expect(h.logLicenseCreation).not.toHaveBeenCalled();

    expect(h.rollbackEqId).toHaveBeenCalledWith(
      'id',
      created.id,
    );
    expect(h.rollbackEqOrganization).toHaveBeenCalledWith(
      'organization_id',
      context.organizationId,
    );
    expect(h.rollbackSelect).toHaveBeenCalledWith(
      'id, organization_id',
    );
  });

  it('fails critically when integrity compensation cannot be confirmed', async () => {
    const h = createHarness({
      insertData: {
        ...created,
        license_type: 'unexpected',
      },
      rollbackData: [],
    });

    await expect(
      h.service.create(dto, context),
    ).rejects.toThrow(
      'CRITICAL: license creation compensation could not be confirmed',
    );

    expect(h.logLicenseCreation).not.toHaveBeenCalled();

    expect(h.rollbackEqId).toHaveBeenCalledWith(
      'id',
      created.id,
    );
    expect(h.rollbackEqOrganization).toHaveBeenCalledWith(
      'organization_id',
      context.organizationId,
    );
  });

  it('reverts the exact created license when persistent audit fails', async () => {
    const h = createHarness({
      auditReject: true,
    });

    await expect(
      h.service.create(dto, context),
    ).rejects.toThrow(
      'License creation audit failed; creation was reverted',
    );

    expect(h.rollbackEqId).toHaveBeenCalledWith(
      'id',
      created.id,
    );
    expect(h.rollbackEqOrganization).toHaveBeenCalledWith(
      'organization_id',
      context.organizationId,
    );
    expect(h.rollbackSelect).toHaveBeenCalledWith(
      'id, organization_id',
    );
  });

  it('fails critically when audit compensation cannot be confirmed', async () => {
    const h = createHarness({
      auditReject: true,
      rollbackData: [],
    });

    await expect(
      h.service.create(dto, context),
    ).rejects.toThrow(
      'CRITICAL: license creation audit failed and compensation could not be confirmed',
    );
  });

  it('fails critically when the compensation delete reports an error', async () => {
    const h = createHarness({
      auditReject: true,
      rollbackData: null,
      rollbackError: {
        message: 'rollback unavailable',
      },
    });

    await expect(
      h.service.create(dto, context),
    ).rejects.toThrow(
      'CRITICAL: license creation audit failed and compensation could not be confirmed',
    );
  });
});
