import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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

  async create(
    dto: CreateOrganizationDto,
    auditContext: {
      actorUserId: string;
      ipAddress?: string;
      userAgent?: string;
    },
  ): Promise<OrganizationDto> {
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

    if (error || !data) {
      throw new Error(`Supabase error: ${error?.message || 'create failed'}`);
    }

    try {
      await this.auditService.logCreate({
        userId: auditContext.actorUserId,
        organizationId: data.id,
        resourceType: 'organization',
        resourceId: data.id,
        after: data,
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
      });
    } catch (auditError) {
      const { error: rollbackError } = await this.supabaseService
        .getClient()
        .from('organizations')
        .delete()
        .eq('id', data.id)
        .eq('updated_at', data.updated_at)
        .is('deleted_at', null);

      if (rollbackError) {
        throw new Error('Organization audit failed and compensation failed');
      }

      throw auditError;
    }

    return data;
  }

  async update(
    id: string,
    dto: UpdateOrganizationDto,
    auditContext: {
      actorUserId: string;
      ipAddress?: string;
      userAgent?: string;
    },
  ): Promise<OrganizationDto> {
    const before = await this.findOne(id);

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

    try {
      await this.auditService.logUpdate({
        userId: auditContext.actorUserId,
        organizationId: id,
        resourceType: 'organization',
        resourceId: id,
        before,
        after: data,
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
      });
    } catch (auditError) {
      const { error: rollbackError } = await this.supabaseService
        .getClient()
        .from('organizations')
        .update({
          name: before.name,
          description: before.description ?? null,
          updated_at: before.updated_at ?? null,
        })
        .eq('id', id)
        .eq('updated_at', data.updated_at)
        .is('deleted_at', null);

      if (rollbackError) {
        throw new Error('Organization audit failed and compensation failed');
      }

      throw auditError;
    }

    return data;
  }

  private async assertNoDeleteDependencies(
    organizationId: string,
  ): Promise<void> {
    const dependencyTables = [
      'organization_members',
      'licenses',
      'customers',
      'consumer_units',
      'energy_contracts',
      'documents',
    ] as const;

    const client =
      this.supabaseService.getClient();

    for (const table of dependencyTables) {
      const { data, error } = await client
        .from(table)
        .select('id')
        .eq(
          'organization_id',
          organizationId,
        )
        .limit(1);

      if (error) {
        throw new Error(
          `Unable to verify organization dependencies: ${table}`,
        );
      }

      if (
        Array.isArray(data) &&
        data.length > 0
      ) {
        throw new ConflictException(
          'Organization has dependencies that must be resolved before deletion',
        );
      }

      if (
        data !== null &&
        data !== undefined &&
        !Array.isArray(data)
      ) {
        throw new Error(
          `Invalid organization dependency response: ${table}`,
        );
      }
    }
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

    // 2. Falhar fechado quando houver dependências.
    await this.assertNoDeleteDependencies(id);

    // 3. Gerar deletedAt uma única vez (usar em UPDATE e em changes)
    const deletedAt = new Date().toISOString();

    // 4. Soft-delete
    const { error } = await this.supabaseService
      .getClient()
      .from('organizations')
      .update({ deleted_at: deletedAt })
      .eq('id', id)
      .is('deleted_at', null);

    if (error) {
      throw new Error(`Supabase error: ${error.message}`);
    }

    // 5. Registrar auditoria com estado AFTER (after = before + deleted_at)
    const organizationAfter = {
      ...organizationBefore,
      deleted_at: deletedAt,
    };

    try {
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
    } catch (auditError) {
      const { error: rollbackError } = await this.supabaseService
        .getClient()
        .from('organizations')
        .update({ deleted_at: null })
        .eq('id', id)
        .eq('deleted_at', deletedAt);

      if (rollbackError) {
        throw new Error(
          'Organization delete audit failed and compensation failed',
        );
      }

      throw auditError;
    }
  }
}
