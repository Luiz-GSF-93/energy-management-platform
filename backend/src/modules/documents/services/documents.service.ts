import { Injectable, BadRequestException, ConflictException, InternalServerErrorException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from '../../../services/supabase.service';
import { CreateDocumentDto, UpdateDocumentDto } from '../dto/create-document.dto';
import { LicensesService } from '../../licenses/services/licenses.service';
import { validateWriteDto } from '../../../common/validation/validate-write-dto';

@Injectable()
export class DocumentsService {
  constructor(private supabaseService: SupabaseService, private licensesService: LicensesService) {}
  private table(name = 'documents') { return this.supabaseService.getClient().from(name); }
  private async requireDocumentManagement(organizationId: string) {
    await this.licensesService.requireEntitlement(organizationId, 'document_management');
  }
  private check(error: any) {
    if (!error) return;
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
    const { data, error } = await this.table().insert([row]).select().single();
    this.check(error);
    return data;
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
