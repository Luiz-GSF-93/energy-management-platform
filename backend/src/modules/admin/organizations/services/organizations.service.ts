import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../../../../services/supabase.service';
import { AuditService } from '../../../../common/services/audit.service';
import { OrganizationDto } from '../dto/organizations.dto';
import { CreateOrganizationDto } from '../dto/create-organization.dto';
import { UpdateOrganizationDto } from '../dto/update-organization.dto';
import { randomUUID } from 'crypto';

@Injectable()
export class OrganizationsService {
  constructor(
    private supabaseService: SupabaseService,
    private auditService: AuditService,
  ) {}

  async findAll(): Promise<OrganizationDto[]> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('organizations')
      .select('*')
      .is('deleted_at', null)
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
      .is('deleted_at', null)
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
          deleted_at: null,
        },
      ])
      .select()
      .single();

    if (error) {
      throw new Error(`Supabase error: ${error.message}`);
    }

    return data;
  }

  async update(id: string, dto: UpdateOrganizationDto): Promise<OrganizationDto> {
    // Verificar existência (e que não está deletada)
    await this.findOne(id);

    if (dto.name !== undefined && dto.name.trim().length === 0) {
      throw new BadRequestException('Organization name cannot be empty');
    }

    const updateData: Record<string, string | null> = {
      updated_at: new Date().toISOString(),
    };

    if (dto.name !== undefined) {
      updateData.name = dto.name.trim();
    }

    if (dto.description !== undefined) {
      updateData.description = dto.description.trim() || null;
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .from('organizations')
      .update(updateData)
      .eq('id', id)
      .is('deleted_at', null)
      .select()
      .single();

    if (error || !data) {
      if (error) {
        throw new Error(`Supabase error: ${error.message}`);
      }

      throw new NotFoundException(`Organization ${id} not found`);
    }

    return data;
  }

  async delete(
    id: string,
    auditContext: {
      actorUserId: string;
      ipAddress?: string;
      userAgent?: string;
    },
  ): Promise<void> {
    // 1. Carregar estado BEFORE (para auditoria)
    const organizationBefore = await this.findOne(id);

    // 2. Gerar deletedAt uma única vez (usar em UPDATE e em changes)
    const deletedAt = new Date().toISOString();

    // 3. Soft-delete
    const { error } = await this.supabaseService
      .getClient()
      .from('organizations')
      .update({ deleted_at: deletedAt })
      .eq('id', id)
      .is('deleted_at', null);

    if (error) {
      throw new Error(`Supabase error: ${error.message}`);
    }

    // 4. Registrar auditoria com estado AFTER (after = before + deleted_at)
    const organizationAfter = {
      ...organizationBefore,
      deleted_at: deletedAt,
    };

    await this.auditService.logDelete({
      userId: auditContext.actorUserId,
      organizationId: id,
      resourceType: 'organization',
      resourceId: id,
      before: organizationBefore,
      after: organizationAfter,
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });
  }
}
