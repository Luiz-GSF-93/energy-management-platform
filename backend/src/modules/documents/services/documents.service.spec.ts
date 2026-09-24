import { DocumentsService } from './documents.service';

describe('Document persistence boundary', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const body = { customerId: id, consumerUnitId: id, fileName: 'invoice.pdf', fileType: 'application/pdf', documentType: 'INVOICE_DISTRIBUTOR', referenceMonth: '2026-09-01', fileHash: 'a'.repeat(64), fileSizeBytes: 100, filePath: `org-a/${id}/invoice.pdf` };
  let queries: any, from: jest.Mock, service: DocumentsService;
  const query = (data: any) => {
    const q: any = {};
    for (const name of ['select','eq','is','insert','update','delete']) q[name] = jest.fn(() => q);
    q.single = jest.fn().mockResolvedValue({ data, error: null });
    q.maybeSingle = jest.fn().mockResolvedValue({ data, error: null });
    return q;
  };
  beforeEach(() => {
    queries = { consumer_units: query({ id, customer_id: id }), customers: query({ id }), energy_contracts: query({ id }), documents: query({ id, processing_status: 'PENDING', ocr_status: 'PENDING', invoice_id: null }) };
    from = jest.fn(table => queries[table]);
    service = new DocumentsService({ getClient: () => ({ from }) } as any, { requireEntitlement: jest.fn() } as any);
  });
  it('maps metadata and derives uploader from authenticated context', async () => {
    await service.create({ ...body, fileHash: 'A'.repeat(64), energyContractId: id, description: 'Invoice' }, 'org-a', id);
    expect(queries.documents.insert).toHaveBeenCalledWith([expect.objectContaining({ organization_id: 'org-a', customer_id: id, consumer_unit_id: id, original_filename: 'invoice.pdf', mime_type: 'application/pdf', file_hash: 'a'.repeat(64), uploaded_by_auth_user_id: id, license_check_passed: true, reference_month: '2026-09-01', processing_status: 'PENDING', ocr_status: 'PENDING', description: 'Invoice' })]);
    for (const table of ['consumer_units','customers','energy_contracts']) expect(queries[table].eq).toHaveBeenCalledWith('organization_id', 'org-a');
    expect(queries.energy_contracts.eq).toHaveBeenCalledWith('consumer_unit_id', id);
    expect(queries.energy_contracts.eq).toHaveBeenCalledWith('customer_id', id);
    expect(queries.customers.is).toHaveBeenCalledWith('deleted_at', null);
  });
  it.each([{ fileHash: 'bad' }, { fileHash: null }, { consumerUnitId: undefined }, { fileSizeBytes: 0 }, { fileSizeBytes: 1.5 }, { fileSizeBytes: 2147483648 }, { referenceMonth: '2026-02-30' }, { referenceMonth: '2026-09-02' }, { fileType: 'text/html' }, { fileName: ' ' }, { documentType: 'BAD' }, { ocrData: '{}' }, { processing_status: 'COMPLETED' }, { uploaded_by_auth_user_id: id }, { filePath: `org-b/${id}/f.pdf` }, { filePath: `org-a/${id}/../f.pdf` }, { filePath: `org-a/${id}/%2e%2e/f.pdf` }])('rejects invalid or forged metadata %p', async invalid => {
    await expect(service.create({ ...body, ...invalid } as any, 'org-a', id)).rejects.toMatchObject({ status: 400 });
    expect(from).not.toHaveBeenCalled();
  });
  it('requires an authenticated uploader', async () => {
    await expect(service.create(body, 'org-a')).rejects.toMatchObject({ status: 401 });
    expect(from).not.toHaveBeenCalled();
  });
  it.each(['consumer_units','customers','energy_contracts'])('rejects a foreign or absent parent %s', async table => {
    queries[table].maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(service.create({ ...body, energyContractId: id }, 'org-a', id)).rejects.toMatchObject({ status: 404 });
    expect(queries.documents.insert).not.toHaveBeenCalled();
  });
  it.each([{ processing_status: 'COMPLETED' }, { processing_status: 'PROCESSING' }, { ocr_status: 'COMPLETED' }, { invoice_id: 'invoice-a' }])('preserves processed/linked documents %p', async state => {
    queries.documents.maybeSingle.mockResolvedValue({ data: { processing_status: 'PENDING', ocr_status: 'PENDING', invoice_id: null, ...state }, error: null });
    await expect(service.update(id, 'org-a', { description: 'changed' })).rejects.toMatchObject({ status: 409 });
    expect(queries.documents.update).not.toHaveBeenCalled();
  });
  it('updates only unprocessed description with a concurrency predicate', async () => {
    await service.update(id, 'org-a', { description: null } as any);
    expect(queries.documents.update).toHaveBeenCalledWith({ description: null });
    expect(queries.documents.eq).toHaveBeenCalledWith('processing_status', 'PENDING');
    expect(queries.documents.eq).toHaveBeenCalledWith('ocr_status', 'PENDING');
    expect(queries.documents.is).toHaveBeenCalledWith('invoice_id', null);
  });
  it('detects processing started during editing', async () => {
    queries.documents.maybeSingle.mockResolvedValueOnce({ data: { processing_status: 'PENDING', ocr_status: 'PENDING', invoice_id: null }, error: null }).mockResolvedValueOnce({ data: null, error: null });
    await expect(service.update(id, 'org-a', { description: 'Changed' })).rejects.toMatchObject({ status: 409 });
  });
  it('blocks deletion until an audited admin workflow exists', async () => {
    await expect(service.delete(id, 'org-a')).rejects.toMatchObject({ status: 409 });
    expect(queries.documents.delete).not.toHaveBeenCalled();
  });
  it('returns 404 for foreign reads and mutations', async () => {
    queries.documents.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(service.findOne(id, 'org-b')).rejects.toMatchObject({ status: 404 });
    await expect(service.update(id, 'org-b', { description: 'X' })).rejects.toMatchObject({ status: 404 });
    await expect(service.delete(id, 'org-b')).rejects.toMatchObject({ status: 404 });
  });
  it('translates duplicates and sanitizes internal errors', async () => {
    queries.documents.single.mockResolvedValue({ data: null, error: { code: '23505', message: 'private' } });
    await expect(service.create(body, 'org-a', id)).rejects.toMatchObject({ status: 409 });
    queries.documents.single.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'private' } });
    await expect(service.create(body, 'org-a', id)).rejects.toThrow('Unable to access documents');
  });
});
