import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../../services/supabase.service';
import { CreateDocumentDto, UpdateDocumentDto } from '../dto/create-document.dto';

@Injectable()
export class DocumentsService {
  constructor(private supabaseService: SupabaseService) {}

  async findAll(organizationId: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('documents')
      .select('*')
      .eq('organization_id', organizationId);

    if (error) throw new Error(error.message);
    return data;
  }

  async findOne(id: string, organizationId: string) {
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
