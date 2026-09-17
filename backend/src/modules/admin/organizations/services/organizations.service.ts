import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../../../../services/supabase.service';
import { OrganizationDto } from '../dto/organizations.dto';
import { CreateOrganizationDto } from '../dto/create-organization.dto';
import { randomUUID } from 'crypto';

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

  async create(dto: CreateOrganizationDto): Promise<OrganizationDto> {
    if (!dto.name || dto.name.trim().length === 0) {
      throw new BadRequestException('Organization name is required');
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    const { data, error } = await this.supabaseService
      .getClient()
      .from('organizations')
      .insert([
        {
          id,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          created_at: now,
          updated_at: now,
        },
      ])
      .select()
      .single();

    if (error) {
      throw new Error(`Supabase error: ${error.message}`);
    }

    return data;
  }
}
