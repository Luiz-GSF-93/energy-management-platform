import { ForbiddenException } from '@nestjs/common';
import { DocumentsService } from './documents.service';

describe('DocumentsService entitlement enforcement', () => {
  const organizationId = 'org-1';

  const createHarness = () => {
    const from = jest.fn();

    const supabaseService = {
      getClient: jest.fn(() => ({ from })),
    };

    const requireEntitlement = jest.fn();

    const licensesService = {
      requireEntitlement,
    };

    const service = new DocumentsService(
      supabaseService as any,
      licensesService as any,
    );

    return {
      service,
      from,
      supabaseService,
      requireEntitlement,
    };
  };

  const deny = (h: ReturnType<typeof createHarness>) => {
    h.requireEntitlement.mockRejectedValue(
      new ForbiddenException('denied'),
    );
  };

  it('checks document_management before findAll persistence access', async () => {
    const h = createHarness();
    deny(h);

    await expect(
      h.service.findAll(organizationId),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(h.requireEntitlement).toHaveBeenCalledWith(
      organizationId,
      'document_management',
    );
    expect(h.supabaseService.getClient).not.toHaveBeenCalled();
    expect(h.from).not.toHaveBeenCalled();
  });

  it('checks document_management before findOne persistence access', async () => {
    const h = createHarness();
    deny(h);

    await expect(
      h.service.findOne('document-1', organizationId),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(h.requireEntitlement).toHaveBeenCalledWith(
      organizationId,
      'document_management',
    );
    expect(h.supabaseService.getClient).not.toHaveBeenCalled();
    expect(h.from).not.toHaveBeenCalled();
  });

  it('checks document_management before create persistence access', async () => {
    const h = createHarness();
    deny(h);

    await expect(
      h.service.create({} as any, organizationId),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(h.requireEntitlement).toHaveBeenCalledWith(
      organizationId,
      'document_management',
    );
    expect(h.supabaseService.getClient).not.toHaveBeenCalled();
    expect(h.from).not.toHaveBeenCalled();
  });

  it('checks document_management before update persistence access', async () => {
    const h = createHarness();
    deny(h);

    await expect(
      h.service.update('document-1', organizationId, {} as any),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(h.requireEntitlement).toHaveBeenCalledWith(
      organizationId,
      'document_management',
    );
    expect(h.supabaseService.getClient).not.toHaveBeenCalled();
    expect(h.from).not.toHaveBeenCalled();
  });

  it('checks document_management before delete persistence access', async () => {
    const h = createHarness();
    deny(h);

    await expect(
      h.service.delete('document-1', organizationId),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(h.requireEntitlement).toHaveBeenCalledWith(
      organizationId,
      'document_management',
    );
    expect(h.supabaseService.getClient).not.toHaveBeenCalled();
    expect(h.from).not.toHaveBeenCalled();
  });
});
