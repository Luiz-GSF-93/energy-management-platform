import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../../../services/supabase.service';
import { OrganizationDto } from '../dto/organizations.dto';

@Injectable()
export class OrganizationsService {
  constructor(private supabaseService: SupabaseService) {}

  async findAll(): Promise<OrganizationDto[]> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('organizations')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Supabase error: ${error.message}`);
    }

    return data || [];
  }

  async findOne(id: string): Promise<OrganizationDto> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('organizations')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException(`Organization ${id} not found`);
    }

    return data;
  }
}
