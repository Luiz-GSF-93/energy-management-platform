import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { LicenseRecord, LicensesService } from './licenses.service';

const before: LicenseRecord = {
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

const context = {
  actorUserId: 'user-1',
  organizationId: 'org-1',
  ipAddress: '203.0.113.10',
  userAgent: 'F1.4i.3-test',
};

function createHarness(options: {
  beforeRow?: LicenseRecord | null;
  loadError?: any;
  updatedRows?: LicenseRecord[] | null;
  updateError?: any;
  auditReject?: boolean;
  revertedRows?: LicenseRecord[] | null;
  rollbackError?: any;
} = {}) {
  const beforeRow =
    options.beforeRow === undefined ? before : options.beforeRow;

  const updatedDefault: LicenseRecord = {
    ...before,
    documents_limit: 200,
    updated_at: '2026-09-21T21:00:00',
  };

  const loadResult = {
    data: beforeRow ? [beforeRow] : [],
    error: options.loadError ?? null,
  };

  const updateResult = {
    data:
      options.updatedRows === undefined
        ? [updatedDefault]
        : options.updatedRows,
    error: options.updateError ?? null,
  };

  const rollbackResult = {
    data:
      options.revertedRows === undefined
        ? [before]
        : options.revertedRows,
    error: options.rollbackError ?? null,
  };

  let updateCall = 0;

  const makeMutationQuery = (result: any) => {
    const query: any = {};
    query.eq = jest.fn(() => query);
    query.is = jest.fn(() => query);
    query.select = jest.fn().mockResolvedValue(result);
    return query;
  };

  const updateQuery = makeMutationQuery(updateResult);
  const rollbackQuery = makeMutationQuery(rollbackResult);

  const loadQuery: any = {};
  loadQuery.select = jest.fn(() => loadQuery);
  loadQuery.eq = jest.fn(() => loadQuery);
  loadQuery.then = (resolve: any) => Promise.resolve(loadResult).then(resolve);

  const update = jest.fn(() => {
    updateCall += 1;
    return updateCall === 1 ? updateQuery : rollbackQuery;
  });

  const from = jest.fn((table: string) => {
    if (table !== 'licenses') {
      throw new Error(`Unexpected table: ${table}`);
    }

    return {
      select: loadQuery.select,
      update,
    };
  });

  const getClient = jest.fn(() => ({ from }));

  const logLicenseUpdate = options.auditReject
    ? jest.fn().mockRejectedValue(new Error('audit failure'))
    : jest.fn().mockResolvedValue(undefined);

  const service = new LicensesService(
    { getClient } as any,
    { logLicenseUpdate } as any,
  );

  return {
    service,
    from,
    update,
    updateQuery,
    rollbackQuery,
    logLicenseUpdate,
  };
}

describe('LicensesService.update — F1.4i.3', () => {
  it('rejects an empty update payload before persistence', async () => {
    const h = createHarness();

    await expect(
      h.service.update('license-1', {}, context),
    ).rejects.toThrow(
      'License update requires at least one field',
    );

    expect(h.from).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
    expect(h.logLicenseUpdate).not.toHaveBeenCalled();
  });

  it('updates inside the validated organization and audits before/after', async () => {
    const h = createHarness();

    const result = await h.service.update(
      'license-1',
      { documentsLimit: 200 },
      context,
    );

    expect(result.documents_limit).toBe(200);
    expect(h.updateQuery.eq).toHaveBeenCalledWith('id', 'license-1');
    expect(h.updateQuery.eq).toHaveBeenCalledWith(
      'organization_id',
      'org-1',
    );
    expect(h.updateQuery.eq).toHaveBeenCalledWith(
      'updated_at',
      before.updated_at,
    );

    expect(h.logLicenseUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'user-1',
        organizationId: 'org-1',
        licenseId: 'license-1',
        before,
        after: expect.objectContaining({
          documents_limit: 200,
        }),
      }),
    );
  });

  it('uses IS NULL CAS for a legacy null updated_at', async () => {
    const legacy = {
      ...before,
      updated_at: null,
    };

    const updated = {
      ...legacy,
      documents_limit: 200,
      updated_at: '2026-09-21T21:00:00',
    };

    const h = createHarness({
      beforeRow: legacy,
      updatedRows: [updated],
    });

    await h.service.update(
      'license-1',
      { documentsLimit: 200 },
      context,
    );

    expect(h.updateQuery.is).toHaveBeenCalledWith('updated_at', null);
    expect(h.updateQuery.eq).not.toHaveBeenCalledWith(
      'updated_at',
      null,
    );
  });

  it('returns idempotently without update or audit', async () => {
    const h = createHarness();

    const result = await h.service.update(
      'license-1',
      { documentsLimit: 100 },
      context,
    );

    expect(result).toEqual(before);
    expect(h.update).not.toHaveBeenCalled();
    expect(h.logLicenseUpdate).not.toHaveBeenCalled();
  });

  it('returns not found when the license is absent from the tenant scope', async () => {
    const h = createHarness({ beforeRow: null });

    await expect(
      h.service.update(
        'license-1',
        { documentsLimit: 200 },
        context,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(h.update).not.toHaveBeenCalled();
    expect(h.logLicenseUpdate).not.toHaveBeenCalled();
  });

  it('derives active=false when lifecycle becomes suspended', async () => {
    const updated = {
      ...before,
      status: 'SUSPENDED',
      active: false,
      updated_at: '2026-09-21T21:00:00',
    };

    const h = createHarness({ updatedRows: [updated] });

    const result = await h.service.update(
      'license-1',
      { status: 'suspended' },
      context,
    );

    expect(result.status).toBe('SUSPENDED');
    expect(result.active).toBe(false);

    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'SUSPENDED',
        active: false,
      }),
    );
  });

  it('derives active=true when lifecycle becomes active', async () => {
    const suspended = {
      ...before,
      status: 'SUSPENDED',
      active: false,
    };

    const updated = {
      ...suspended,
      status: 'ACTIVE',
      active: true,
      updated_at: '2026-09-21T21:00:00',
    };

    const h = createHarness({
      beforeRow: suspended,
      updatedRows: [updated],
    });

    const result = await h.service.update(
      'license-1',
      { status: 'active' },
      context,
    );

    expect(result.status).toBe('ACTIVE');
    expect(result.active).toBe(true);
  });

  it('rejects an active lifecycle without a start date', async () => {
    const legacy = {
      ...before,
      status: 'SUSPENDED',
      active: false,
      start_date: null,
    };

    const h = createHarness({ beforeRow: legacy });

    await expect(
      h.service.update(
        'license-1',
        { status: 'active' },
        context,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(h.update).not.toHaveBeenCalled();
  });

  it('rejects merged validity dates when end precedes start', async () => {
    const h = createHarness();

    await expect(
      h.service.update(
        'license-1',
        { endDate: '2026-09-20' },
        context,
      ),
    ).rejects.toThrow(
      'License end date cannot be before start date',
    );

    expect(h.update).not.toHaveBeenCalled();
  });

  it('maps the exact exclusion constraint conflict to ConflictException', async () => {
    const h = createHarness({
      updateError: {
        code: '23P01',
        message:
          'conflicting key value violates exclusion constraint "licenses_active_validity_excl"',
      },
    });

    await expect(
      h.service.update(
        'license-1',
        { documentsLimit: 200 },
        context,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(h.logLicenseUpdate).not.toHaveBeenCalled();
  });

  it('fails closed on an unknown persistence error', async () => {
    const h = createHarness({
      updateError: {
        code: 'XX000',
        message: 'database failure',
      },
    });

    await expect(
      h.service.update(
        'license-1',
        { documentsLimit: 200 },
        context,
      ),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(h.logLicenseUpdate).not.toHaveBeenCalled();
  });

  it('detects CAS concurrency when no row is updated', async () => {
    const h = createHarness({ updatedRows: [] });

    await expect(
      h.service.update(
        'license-1',
        { documentsLimit: 200 },
        context,
      ),
    ).rejects.toThrow(
      'License changed concurrently; reload before updating',
    );

    expect(h.logLicenseUpdate).not.toHaveBeenCalled();
  });

  it('reverts its own write when persistent audit fails', async () => {
    const h = createHarness({ auditReject: true });

    await expect(
      h.service.update(
        'license-1',
        { documentsLimit: 200 },
        context,
      ),
    ).rejects.toThrow(
      'License update audit failed; update was reverted',
    );

    expect(h.rollbackQuery.eq).toHaveBeenCalledWith(
      'id',
      'license-1',
    );
    expect(h.rollbackQuery.eq).toHaveBeenCalledWith(
      'organization_id',
      'org-1',
    );
    expect(h.rollbackQuery.eq).toHaveBeenCalledWith(
      'updated_at',
      '2026-09-21T21:00:00',
    );
  });

  it('fails critically when audit rollback cannot be confirmed', async () => {
    const h = createHarness({
      auditReject: true,
      revertedRows: [],
    });

    await expect(
      h.service.update(
        'license-1',
        { documentsLimit: 200 },
        context,
      ),
    ).rejects.toThrow(
      'CRITICAL: license update audit failed and rollback could not be confirmed',
    );
  });

  it('reverts when returned updated content violates the requested postcondition', async () => {
    const invalidAfter = {
      ...before,
      documents_limit: 999,
      updated_at: '2026-09-21T21:00:00',
    };

    const h = createHarness({
      updatedRows: [invalidAfter],
    });

    await expect(
      h.service.update(
        'license-1',
        { documentsLimit: 200 },
        context,
      ),
    ).rejects.toThrow(
      'License update integrity violation; update was reverted',
    );

    expect(h.logLicenseUpdate).not.toHaveBeenCalled();
    expect(h.rollbackQuery.eq).toHaveBeenCalledWith(
      'updated_at',
      invalidAfter.updated_at,
    );
  });
});
