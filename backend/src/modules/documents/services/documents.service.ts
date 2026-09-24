import { createHash, randomUUID } from 'crypto';
import { UploadDocumentDto } from '../dto/upload-document.dto';
import { DOCUMENT_BUCKET, DocumentFile, inspectDocument } from './document-file';
import { Injectable, BadRequestException, ConflictException, InternalServerErrorException, NotFoundException, UnauthorizedException, ForbiddenException, ServiceUnavailableException, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../services/supabase.service';
import { CreateDocumentDto, UpdateDocumentDto } from '../dto/create-document.dto';
import { LicensesService } from '../../licenses/services/licenses.service';
import { validateWriteDto } from '../../../common/validation/validate-write-dto';

// A PostgreSQL constraint rejection proves the INSERT did not commit.
class DocumentInsertRejected extends InternalServerErrorException {}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
  constructor(private supabaseService: SupabaseService, private licensesService: LicensesService) {}
  private table(name = 'documents') { return this.supabaseService.getClient().from(name); }
  private async requireDocumentManagement(organizationId: string) {
    await this.licensesService.requireEntitlement(organizationId, 'document_management');
  }
  private check(error: any) {
    if (!error) return;
    if (error.code === 'P0001' && error.message === 'DOCUMENT_QUOTA_EXCEEDED') throw new ForbiddenException('Cota de documentos da licença esgotada');
    if (error.code === 'P0001' && error.message === 'DOCUMENT_LICENSE_REQUIRED') throw new ForbiddenException('Licença de documentos indisponível');
    if (error.code === '23505') throw new ConflictException('Document already registered in this organization');
    throw new InternalServerErrorException('Unable to access documents');
  }
  private async scopedDocument(id: string, organizationId: string) {
    const { data, error } = await this.table().select('*').eq('id', id).eq('organization_id', organizationId).maybeSingle();
    this.check(error);
    if (!data) throw new NotFoundException('Document not found');
    return data;
  }
  async findAll(organizationId: string) {
    await this.requireDocumentManagement(organizationId);
    const { data, error } = await this.table().select('*').eq('organization_id', organizationId);
    this.check(error);
    return data;
  }
  async findOne(id: string, organizationId: string) {
    await this.requireDocumentManagement(organizationId);
    return this.scopedDocument(id, organizationId);
  }
  async create(input: CreateDocumentDto, organizationId: string, actorUserId?: string) {
    return this.insertRecord(await this.prepareCreate(input, organizationId, actorUserId));
  }
  private async prepareCreate(input: CreateDocumentDto, organizationId: string, actorUserId?: string) {
    await this.requireDocumentManagement(organizationId);
    const dto = await validateWriteDto(CreateDocumentDto, input);
    if (!actorUserId) throw new UnauthorizedException('Authenticated uploader required');
    const segments = dto.filePath.split('/');
    if (!dto.filePath.startsWith(`${organizationId}/${dto.consumerUnitId}/`) || segments.some(s => !s || s === '.' || s === '..')) {
      throw new BadRequestException('filePath must be an object key inside the organization and consumer unit');
    }
    const unit = await this.table('consumer_units').select('id,customer_id').eq('id', dto.consumerUnitId).eq('organization_id', organizationId).eq('customer_id', dto.customerId).maybeSingle();
    this.check(unit.error);
    if (!unit.data) throw new NotFoundException('Consumer unit not found for this customer');
    const customer = await this.table('customers').select('id').eq('id', dto.customerId).eq('organization_id', organizationId).is('deleted_at', null).maybeSingle();
    this.check(customer.error);
    if (!customer.data) throw new NotFoundException('Customer not found');
    if (dto.energyContractId) {
      const contract = await this.table('energy_contracts').select('id').eq('id', dto.energyContractId).eq('organization_id', organizationId).eq('customer_id', dto.customerId).eq('consumer_unit_id', dto.consumerUnitId).maybeSingle();
      this.check(contract.error);
      if (!contract.data) throw new NotFoundException('Contract not found for this consumer unit');
    }
    // Metadata registration only: supplied hash/MIME/path are not verified file
    // contents. A future upload worker must verify bytes before processing.
    const row: Record<string, unknown> = {
      organization_id: organizationId, customer_id: dto.customerId, consumer_unit_id: dto.consumerUnitId,
      document_type: dto.documentType, reference_month: dto.referenceMonth,
      original_filename: dto.fileName, mime_type: dto.fileType, file_hash: dto.fileHash,
      file_size_bytes: dto.fileSizeBytes, file_path: dto.filePath,
      uploaded_by_auth_user_id: actorUserId, license_check_passed: true,
      processing_status: 'PENDING', ocr_status: 'PENDING',
    };
    if (dto.energyContractId !== undefined) row.energy_contract_id = dto.energyContractId;
    if (dto.description !== undefined) row.description = dto.description;
    return row;
  }
  private async insertRecord(row: Record<string, unknown>) {
    const { data, error } = await this.table().insert([row]).select().single();
    if (error && ['23502', '23503', '23514'].includes(error.code)) {
      this.logger.error('Document insert rejected by constraint: ' + error.code);
      throw new DocumentInsertRejected('Não foi possível registrar o documento. Tente novamente após a correção administrativa.');
    }
    this.check(error);
    return data;
  }

  async upload(input: UploadDocumentDto, file: DocumentFile | undefined, organizationId: string, actorUserId?: string) {
    await this.requireDocumentManagement(organizationId);
    const dto = await validateWriteDto(UploadDocumentDto, input);
    const detected = inspectDocument(file);
    const bytes = file!.buffer;
    const path = organizationId + '/' + dto.consumerUnitId + '/' + randomUUID() + '.' + detected.extension;
    const row = await this.prepareCreate({ ...dto, fileName: detected.name, fileType: detected.mime,
      fileHash: createHash('sha256').update(bytes).digest('hex'), fileSizeBytes: bytes.length, filePath: path }, organizationId, actorUserId);
    const duplicate = await this.table().select('id').eq('organization_id', organizationId).eq('file_hash', row.file_hash).maybeSingle();
    this.check(duplicate.error);
    if (duplicate.data) throw new ConflictException('Documento já cadastrado nesta organização');
    const storage = this.supabaseService.getClient().storage.from(DOCUMENT_BUCKET);
    // Every attempt owns a fresh random key. Compensation never touches a
    // pre-existing object, including when concurrent inserts hit the hash index.
    let insertionStarted = false;
    try {
      const result = await storage.upload(path, bytes, { contentType: detected.mime, upsert: false });
      if (result.error) throw new ServiceUnavailableException('Não foi possível armazenar o arquivo');
      insertionStarted = true;
      return await this.insertRecord({ ...row, file_verified: true, storage_bucket: DOCUMENT_BUCKET, file_verified_at: new Date().toISOString() });
    } catch (error) {
      const status = (error as any)?.getStatus?.();
      if (insertionStarted && status !== 403 && status !== 409 && !(error instanceof DocumentInsertRejected)) {
        // A lost response does not mean the INSERT rolled back. Never remove
        // bytes while a committed document may reference them.
        try {
          const recovery = await this.table().select('*').eq('organization_id', organizationId).eq('file_path', path).maybeSingle();
          if (recovery.error) throw recovery.error;
          if (recovery.data) {
            if (recovery.data.file_verified === true && recovery.data.file_hash === row.file_hash) return recovery.data;
            throw new Error('Unexpected recovery record');
          }
          throw new Error('Insert outcome still unknown');
        } catch {
          this.logger.error('Document insert outcome needs reconciliation for key ' + path);
          throw new ServiceUnavailableException('Resultado do envio indeterminado; aguarde verificação administrativa');
        }
      }
      // A transport failure may occur after the object was accepted. Attempt
      // cleanup even then; a failed cleanup is explicit and needs reconciliation.
      try {
        const cleanup = await storage.remove([path]);
        if (cleanup.error) throw cleanup.error;
      } catch {
        this.logger.error('Document upload cleanup failed for key ' + path);
        throw new ServiceUnavailableException('Falha no envio; a limpeza do arquivo precisa de verificação administrativa');
      }
      if (error instanceof Error && 'getStatus' in error) throw error;
      throw new ServiceUnavailableException('Falha no envio do documento');
    }
  }
  async download(id: string, organizationId: string, inline = false) {
    await this.requireDocumentManagement(organizationId);
    const row = await this.scopedDocument(id, organizationId);
    if (row.file_verified !== true || row.storage_bucket !== DOCUMENT_BUCKET ||
        typeof row.file_path !== 'string' || !row.file_path.startsWith(organizationId + '/' + row.consumer_unit_id + '/') ||
        row.file_path.split('/').some((part: string) => !part || part === '.' || part === '..')) {
      throw new ConflictException('Este registro ainda não possui arquivo verificado');
    }
    const result = await this.supabaseService.getClient().storage.from(DOCUMENT_BUCKET)
      .createSignedUrl(row.file_path, 60, { download: inline ? false : row.original_filename });
    if (result.error || !result.data?.signedUrl) throw new ServiceUnavailableException('Arquivo temporariamente indisponível');
    return { url: result.data.signedUrl, expiresIn: 60 };
  }
  async update(id: string, organizationId: string, input: UpdateDocumentDto) {
    await this.requireDocumentManagement(organizationId);
    const dto = await validateWriteDto(UpdateDocumentDto, input);
    const current = await this.scopedDocument(id, organizationId);
    if (current.processing_status !== 'PENDING' || current.ocr_status !== 'PENDING' || current.invoice_id !== null) {
      throw new ConflictException('Processed or linked documents are immutable');
    }
    const { data, error } = await this.table().update({ description: dto.description }).eq('id', id).eq('organization_id', organizationId)
      .eq('processing_status', 'PENDING').eq('ocr_status', 'PENDING').is('invoice_id', null).select().maybeSingle();
    this.check(error);
    if (!data) throw new ConflictException('Document changed; reload before editing');
    return data;
  }
  async delete(id: string, organizationId: string) {
    await this.requireDocumentManagement(organizationId);
    await this.scopedDocument(id, organizationId);
    // No destructive shortcut until the exceptional administrative/audited
    // deletion workflow required by the architecture exists.
    throw new ConflictException('Document deletion requires an audited administrative workflow');
  }
}
