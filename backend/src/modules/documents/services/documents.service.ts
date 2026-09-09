import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../../services/supabase.service';
import { CreateDocumentDto, UpdateDocumentDto } from '../dto/create-document.dto';

@Injectable()
export class DocumentsService {
  constructor(private supabaseService: SupabaseService) {}

  async create(createDocumentDto: CreateDocumentDto) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('documents')
      .insert([{ ...createDocumentDto, processingStatus: 'PENDING' }])
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async findByCustomer(customerId: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('documents')
      .select('*')
      .eq('customerId', customerId)
      .is('deletedAt', null);

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async findOne(id: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('documents')
      .select('*')
      .eq('id', id)
      .is('deletedAt', null)
      .single();

    if (error || !data) throw new NotFoundException('Document not found');
    return data;
  }

  async update(id: string, updateDocumentDto: UpdateDocumentDto) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('documents')
      .update(updateDocumentDto)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async delete(id: string) {
    const { error } = await this.supabaseService
      .getClient()
      .from('documents')
      .update({ deletedAt: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new BadRequestException(error.message);
    return { message: 'Document deleted successfully' };
  }
}
