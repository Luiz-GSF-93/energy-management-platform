import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../../services/supabase.service';
import { CreateDocumentDto, UpdateDocumentDto } from '../dto/create-document.dto';
import { LicensesService } from '../../licenses/services/licenses.service';
import { validateWriteDto } from '../../../common/validation/validate-write-dto';

@Injectable()
export class DocumentsService {
  constructor(
    private supabaseService: SupabaseService,
    private licensesService: LicensesService,
  ) {}

  private async requireDocumentManagement(
    organizationId: string,
  ): Promise<void> {
    await this.licensesService.requireEntitlement(
      organizationId,
      'document_management',
    );
  }

  async findAll(organizationId: string) {
    await this.requireDocumentManagement(organizationId);

    const { data, error } = await this.supabaseService
      .getClient()
      .from('documents')
      .select('*')
      .eq('organization_id', organizationId);

    if (error) throw new Error(error.message);
    return data;
  }

  async findOne(id: string, organizationId: string) {
    await this.requireDocumentManagement(organizationId);

    const { data, error } = await this.supabaseService
      .getClient()
      .from('documents')
      .select('*')
      .eq('id', id)
      .eq('organization_id', organizationId)
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async create(createDocumentDto: CreateDocumentDto, organizationId: string) {
    await this.requireDocumentManagement(organizationId);
    createDocumentDto = await validateWriteDto(CreateDocumentDto, createDocumentDto);

    const { data, error } = await this.supabaseService
      .getClient()
      .from('documents')
      .insert([{ ...createDocumentDto, organization_id: organizationId }])
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async update(
    id: string,
    organizationId: string,
    updateDocumentDto: UpdateDocumentDto,
  ) {
    await this.requireDocumentManagement(organizationId);
    updateDocumentDto = await validateWriteDto(UpdateDocumentDto, updateDocumentDto);

    const { data, error } = await this.supabaseService
      .getClient()
      .from('documents')
      .update(updateDocumentDto)
      .eq('id', id)
      .eq('organization_id', organizationId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async delete(id: string, organizationId: string) {
    await this.requireDocumentManagement(organizationId);

    const { data, error } = await this.supabaseService
      .getClient()
      .from('documents')
      .delete()
      .eq('id', id)
      .eq('organization_id', organizationId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }
}
