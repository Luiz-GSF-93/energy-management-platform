import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../../../services/supabase.service';
import { AuditService } from '../../../../common/services/audit.service';
import { OrganizationDto } from '../dto/organizations.dto';
import { CreateOrganizationDto } from '../dto/create-organization.dto';
import { UpdateOrganizationDto } from '../dto/update-organization.dto';
import { BootstrapOrganizationAdminDto } from '../dto/bootstrap-organization-admin.dto';
import { randomUUID } from 'crypto';

type BootstrapProvisioningPath =
  | 'new_identity'
  | 'existing_identity';

interface BootstrapAuditContext {
  actorUserId: string;
  ipAddress?: string;
  userAgent?: string;
}

interface BootstrapResult {
  userId: string;
  membershipId: string;
  roleId: string;
  membershipStatus: 'active';
  provisioningPath: BootstrapProvisioningPath;
}

interface BootstrapIdentityResolution {
  userId: string;
  provisioningPath: BootstrapProvisioningPath;
  createdIdentity: boolean;
  createdProfile: boolean;
  normalizedEmail: string;
}

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

  private async resolveBootstrapIdentity(
    organizationId: string,
    dto: BootstrapOrganizationAdminDto,
  ): Promise<BootstrapIdentityResolution> {
    const normalizedEmail =
      dto.email.trim().toLowerCase();

    const normalizedName =
      dto.name.trim();

    if (!normalizedEmail) {
      throw new BadRequestException(
        'Bootstrap email is required',
      );
    }

    if (!normalizedName) {
      throw new BadRequestException(
        'Bootstrap name is required',
      );
    }

    const client =
      this.supabaseService.getClient();

    const authClient =
      this.supabaseService.createAuthClient();

    const {
      data: profiles,
      error: profileLookupError,
    } = await client
      .from('user_profiles')
      .select(
        'user_id, email, name, organization_id, affiliation_type',
      )
      .eq(
        'email',
        normalizedEmail,
      );

    if (profileLookupError) {
      throw new InternalServerErrorException(
        'Failed to resolve bootstrap target profile',
      );
    }

    if (
      profiles &&
      profiles.length > 1
    ) {
      throw new InternalServerErrorException(
        'Data integrity error: multiple profiles found for bootstrap email',
      );
    }

    const profile =
      profiles?.[0] ?? null;

    if (profile) {
      if (
        typeof profile.user_id !==
          'string' ||
        profile.user_id.length === 0 ||
        typeof profile.email !==
          'string' ||
        profile.email
          .trim()
          .toLowerCase() !==
          normalizedEmail
      ) {
        throw new InternalServerErrorException(
          'Data integrity error: invalid bootstrap target profile',
        );
      }

      const {
        data: { user },
        error: authLookupError,
      } =
        await authClient.auth.admin
          .getUserById(
            profile.user_id,
          );

      if (
        authLookupError ||
        !user ||
        user.id !==
          profile.user_id ||
        typeof user.email !==
          'string' ||
        user.email
          .trim()
          .toLowerCase() !==
          normalizedEmail
      ) {
        throw new InternalServerErrorException(
          'Bootstrap target identity/profile integrity mismatch',
        );
      }

      if (
        profile.affiliation_type !==
        dto.affiliationType
      ) {
        throw new ConflictException(
          'Existing user affiliation does not match bootstrap request',
        );
      }

      return {
        userId: user.id,
        provisioningPath:
          'existing_identity',
        createdIdentity: false,
        createdProfile: false,
        normalizedEmail,
      };
    }

    const perPage = 100;
    const maxPages = 20;

    let authMatch: any = null;
    let authLookupComplete = false;

    for (
      let page = 1;
      page <= maxPages;
      page += 1
    ) {
      const {
        data,
        error,
      } =
        await authClient.auth.admin
          .listUsers({
            page,
            perPage,
          });

      if (error) {
        throw new InternalServerErrorException(
          'Failed to resolve bootstrap target identity',
        );
      }

      const users =
        Array.isArray(
          data?.users,
        )
          ? data.users
          : [];

      const matches =
        users.filter(
          (user: any) =>
            typeof user?.email ===
              'string' &&
            user.email
              .trim()
              .toLowerCase() ===
              normalizedEmail,
        );

      if (
        matches.length > 1 ||
        (
          authMatch &&
          matches.length > 0
        )
      ) {
        throw new InternalServerErrorException(
          'Data integrity error: multiple auth identities found for bootstrap email',
        );
      }

      if (
        matches.length === 1
      ) {
        authMatch =
          matches[0];
      }

      const lastPage =
        typeof data?.lastPage ===
          'number'
          ? data.lastPage
          : null;

      if (
        lastPage !== null &&
        page >= lastPage
      ) {
        authLookupComplete = true;
        break;
      }

      if (
        users.length < perPage &&
        lastPage === null
      ) {
        authLookupComplete = true;
        break;
      }
    }

    if (!authLookupComplete) {
      throw new InternalServerErrorException(
        'Auth identity lookup exceeded bounded pagination without proving exhaustion',
      );
    }

    if (authMatch) {
      throw new ConflictException(
        'Existing identity has no valid user profile',
      );
    }

    const {
      data: inviteData,
      error: inviteError,
    } =
      await authClient.auth.admin
        .inviteUserByEmail(
          normalizedEmail,
          {
            data: {
              name:
                normalizedName,
            },
          },
        );

    if (
      inviteError ||
      !inviteData?.user ||
      typeof inviteData.user.id !==
        'string' ||
      inviteData.user.id.length ===
        0 ||
      typeof inviteData.user.email !==
        'string' ||
      inviteData.user.email
        .trim()
        .toLowerCase() !==
        normalizedEmail
    ) {
      throw new InternalServerErrorException(
        'Failed to create bootstrap user identity',
      );
    }

    const targetUserId =
      inviteData.user.id;

    let insertedProfiles: any[] | null =
      null;

    let profileInsertError: any =
      null;

    try {
      const result = await client
        .from('user_profiles')
        .insert({
          user_id:
            targetUserId,
          email:
            normalizedEmail,
          name:
            normalizedName,
          organization_id:
            organizationId,
          affiliation_type:
            dto.affiliationType,
        })
        .select(
          'user_id, email, organization_id, affiliation_type',
        );

      insertedProfiles =
        result.data as any[] | null;

      profileInsertError =
        result.error;
    } catch {
      profileInsertError =
        new Error(
          'bootstrap profile insert failed',
        );
    }

    const profileConfirmed =
      Boolean(
        !profileInsertError &&
        insertedProfiles &&
        insertedProfiles.length === 1 &&
        insertedProfiles[0]?.user_id ===
          targetUserId &&
        typeof insertedProfiles[0]?.email ===
          'string' &&
        insertedProfiles[0].email
          .trim()
          .toLowerCase() ===
          normalizedEmail &&
        insertedProfiles[0]
          ?.organization_id ===
          organizationId &&
        insertedProfiles[0]
          ?.affiliation_type ===
          dto.affiliationType,
      );

    if (!profileConfirmed) {
      // The Auth identity is known to belong to this
      // execution. Profile ownership is only assumed
      // when the returned row can be proven.
      let profileCompensated = true;

      if (
        insertedProfiles &&
        insertedProfiles.length === 1 &&
        insertedProfiles[0]?.user_id ===
          targetUserId &&
        typeof insertedProfiles[0]?.email ===
          'string' &&
        insertedProfiles[0].email
          .trim()
          .toLowerCase() ===
          normalizedEmail &&
        insertedProfiles[0]
          ?.organization_id ===
          organizationId &&
        insertedProfiles[0]
          ?.affiliation_type ===
          dto.affiliationType
      ) {
        try {
          const {
            data: deletedProfiles,
            error: profileDeleteError,
          } = await client
            .from('user_profiles')
            .delete()
            .eq(
              'user_id',
              targetUserId,
            )
            .eq(
              'email',
              normalizedEmail,
            )
            .eq(
              'organization_id',
              organizationId,
            )
            .eq(
              'affiliation_type',
              dto.affiliationType,
            )
            .select('user_id');

          profileCompensated =
            Boolean(
              !profileDeleteError &&
              deletedProfiles &&
              deletedProfiles.length === 1 &&
              deletedProfiles[0]?.user_id ===
                targetUserId,
            );
        } catch {
          profileCompensated = false;
        }
      }

      let identityCompensated = false;

      if (profileCompensated) {
        try {
          const {
            error: identityDeleteError,
          } =
            await authClient.auth.admin
              .deleteUser(
                targetUserId,
              );

          identityCompensated =
            !identityDeleteError;
        } catch {
          identityCompensated = false;
        }
      }

      if (
        !profileCompensated ||
        !identityCompensated
      ) {
        throw new InternalServerErrorException(
          'Bootstrap profile provisioning failed and compensation failed',
        );
      }

      throw new InternalServerErrorException(
        'Bootstrap profile provisioning failed; identity was reverted',
      );
    }

    return {
      userId:
        targetUserId,
      provisioningPath:
        'new_identity',
      createdIdentity: true,
      createdProfile: true,
      normalizedEmail,
    };
  }

  async bootstrapAdmin(
    organizationId: string,
    dto: BootstrapOrganizationAdminDto,
    auditContext: BootstrapAuditContext,
  ): Promise<BootstrapResult> {
    const roleId =
      await this.resolveBootstrapAdminRole(
        organizationId,
      );

    const resolution =
      await this.resolveBootstrapIdentity(
        organizationId,
        dto,
      );

    const client =
      this.supabaseService.getClient();

    let rpcRows: any = null;
    let rpcError: any = null;

    try {
      const result = await client.rpc(
        'bootstrap_initial_organization_admin',
        {
          target_organization_id:
            organizationId,
          target_user_id:
            resolution.userId,
        },
      );

      rpcRows =
        result.data;

      rpcError =
        result.error;
    } catch {
      const compensated =
        await this.compensateBootstrapIdentity(
          organizationId,
          dto,
          resolution,
        );

      if (!compensated) {
        throw new InternalServerErrorException(
          'Bootstrap RPC failed and identity compensation failed',
        );
      }

      throw new InternalServerErrorException(
        'Failed to bootstrap organization administrator',
      );
    }

    if (rpcError) {
      const compensated =
        await this.compensateBootstrapIdentity(
          organizationId,
          dto,
          resolution,
        );

      if (!compensated) {
        throw new InternalServerErrorException(
          'Bootstrap RPC failed and identity compensation failed',
        );
      }

      this.throwBootstrapRpcError(
        organizationId,
        rpcError,
      );
    }

    if (
      !Array.isArray(rpcRows) ||
      rpcRows.length !== 1
    ) {
      const compensated =
        await this.compensateBootstrapIdentity(
          organizationId,
          dto,
          resolution,
        );

      if (!compensated) {
        throw new InternalServerErrorException(
          'Bootstrap membership confirmation failed and identity compensation failed',
        );
      }

      throw new InternalServerErrorException(
        'Bootstrap membership creation could not be confirmed',
      );
    }

    const membership =
      rpcRows[0] as any;

    if (
      typeof membership?.membership_id !==
        'string' ||
      membership.membership_id.length === 0 ||
      membership?.organization_id !==
        organizationId ||
      membership?.user_id !==
        resolution.userId ||
      membership?.role_id !==
        roleId ||
      membership?.membership_status !==
        'active'
    ) {
      /*
       * Membership ownership cannot be proven, so no
       * destructive membership compensation is safe.
       *
       * Identity/profile ownership is independent:
       * resources created by this execution remain
       * safe to compensate.
       */
      const identityCompensated =
        await this.compensateBootstrapIdentity(
          organizationId,
          dto,
          resolution,
        );

      if (!identityCompensated) {
        throw new InternalServerErrorException(
          'Bootstrap membership integrity violation and identity compensation failed',
        );
      }

      throw new InternalServerErrorException(
        'Bootstrap membership integrity violation',
      );
    }

    const membershipId: string =
      membership.membership_id;

    try {
      await this.auditService
        .logInitialOrganizationAdminBootstrap({
          actorUserId:
            auditContext.actorUserId,
          organizationId,
          targetUserId:
            resolution.userId,
          membershipId,
          roleId,
          affiliationType:
            dto.affiliationType,
          provisioningPath:
            resolution.provisioningPath,
          ipAddress:
            auditContext.ipAddress,
          userAgent:
            auditContext.userAgent,
        });
    } catch {
      const membershipCompensated =
        await this
          .compensateBootstrapMembership(
            organizationId,
            resolution.userId,
            membershipId,
            roleId,
          );

      if (!membershipCompensated) {
        throw new InternalServerErrorException(
          'Bootstrap audit failed and membership compensation failed',
        );
      }

      const identityCompensated =
        await this.compensateBootstrapIdentity(
          organizationId,
          dto,
          resolution,
        );

      if (!identityCompensated) {
        throw new InternalServerErrorException(
          'Bootstrap audit failed and identity compensation failed',
        );
      }

      throw new InternalServerErrorException(
        'Bootstrap audit failed; provisioning was reverted',
      );
    }

    return {
      userId:
        resolution.userId,
      membershipId,
      roleId,
      membershipStatus:
        'active',
      provisioningPath:
        resolution.provisioningPath,
    };
  }

  private throwBootstrapRpcError(
    organizationId: string,
    error: any,
  ): never {
    const code =
      typeof error?.code === 'string'
        ? error.code
        : '';

    switch (code) {
      case 'P3001':
        throw new BadRequestException(
          'Invalid bootstrap request',
        );

      case 'P3002':
        throw new NotFoundException(
          `Organization ${organizationId} not found`,
        );

      case 'P3010':
        throw new ConflictException(
          'Organization already has an active administrator',
        );

      case 'P3011':
        throw new ConflictException(
          'User already has a membership in this organization',
        );

      case 'P3012':
        throw new ConflictException(
          'Organization membership was created concurrently',
        );

      case 'P3003':
      case 'P3004':
      case 'P3005':
        throw new InternalServerErrorException(
          'Bootstrap database integrity failure',
        );

      default:
        throw new InternalServerErrorException(
          'Failed to bootstrap organization administrator',
        );
    }
  }

  private async compensateBootstrapMembership(
    organizationId: string,
    userId: string,
    membershipId: string,
    roleId: string,
  ): Promise<boolean> {
    const client =
      this.supabaseService.getClient();

    try {
      const {
        data: deletedMemberships,
        error: deleteError,
      } = await client
        .from('organization_members')
        .delete()
        .eq('id', membershipId)
        .eq('user_id', userId)
        .eq(
          'organization_id',
          organizationId,
        )
        .eq('role_id', roleId)
        .eq('status', 'active')
        .select(
          'id, user_id, organization_id, role_id, status',
        );

      return Boolean(
        !deleteError &&
        deletedMemberships &&
        deletedMemberships.length === 1 &&
        deletedMemberships[0]?.id ===
          membershipId &&
        deletedMemberships[0]?.user_id ===
          userId &&
        deletedMemberships[0]
          ?.organization_id ===
          organizationId &&
        deletedMemberships[0]?.role_id ===
          roleId &&
        deletedMemberships[0]?.status ===
          'active',
      );
    } catch {
      return false;
    }
  }

  private async compensateBootstrapIdentity(
    organizationId: string,
    dto: BootstrapOrganizationAdminDto,
    resolution: BootstrapIdentityResolution,
  ): Promise<boolean> {
    if (
      !resolution.createdIdentity &&
      !resolution.createdProfile
    ) {
      return true;
    }

    const client =
      this.supabaseService.getClient();

    const authClient =
      this.supabaseService.createAuthClient();

    if (resolution.createdProfile) {
      try {
        const {
          data: deletedProfiles,
          error: profileDeleteError,
        } = await client
          .from('user_profiles')
          .delete()
          .eq(
            'user_id',
            resolution.userId,
          )
          .eq(
            'email',
            resolution.normalizedEmail,
          )
          .eq(
            'organization_id',
            organizationId,
          )
          .eq(
            'affiliation_type',
            dto.affiliationType,
          )
          .select(
            'user_id, email, organization_id, affiliation_type',
          );

        if (
          profileDeleteError ||
          !deletedProfiles ||
          deletedProfiles.length !== 1 ||
          deletedProfiles[0]?.user_id !==
            resolution.userId ||
          typeof deletedProfiles[0]?.email !==
            'string' ||
          deletedProfiles[0].email
            .trim()
            .toLowerCase() !==
            resolution.normalizedEmail ||
          deletedProfiles[0]
            ?.organization_id !==
            organizationId ||
          deletedProfiles[0]
            ?.affiliation_type !==
            dto.affiliationType
        ) {
          return false;
        }
      } catch {
        return false;
      }
    }

    if (resolution.createdIdentity) {
      try {
        const {
          error: identityDeleteError,
        } =
          await authClient.auth.admin
            .deleteUser(
              resolution.userId,
            );

        if (identityDeleteError) {
          return false;
        }
      } catch {
        return false;
      }
    }

    return true;
  }

  private async resolveBootstrapAdminRole(
    organizationId: string,
  ): Promise<string> {
    const client =
      this.supabaseService.getClient();

    const {
      data: organizations,
      error: organizationError,
    } = await client
      .from('organizations')
      .select('id')
      .eq('id', organizationId)
      .is('deleted_at', null);

    if (organizationError) {
      throw new InternalServerErrorException(
        'Failed to validate bootstrap organization',
      );
    }

    if (
      !organizations ||
      organizations.length === 0
    ) {
      throw new NotFoundException(
        `Organization ${organizationId} not found`,
      );
    }

    if (organizations.length !== 1) {
      throw new InternalServerErrorException(
        'Data integrity error: multiple bootstrap organizations found',
      );
    }

    if (
      organizations[0]?.id !==
      organizationId
    ) {
      throw new InternalServerErrorException(
        'Data integrity error: invalid bootstrap organization',
      );
    }

    const {
      data: roles,
      error: roleError,
    } = await client
      .from('roles')
      .select(
        'id, name, organization_id, scope',
      )
      .eq(
        'organization_id',
        organizationId,
      )
      .eq('scope', 'organization')
      .eq('name', 'admin_org');

    if (roleError) {
      throw new InternalServerErrorException(
        'Failed to resolve bootstrap admin role',
      );
    }

    if (
      !roles ||
      roles.length !== 1
    ) {
      throw new InternalServerErrorException(
        'Data integrity error: bootstrap admin role must resolve exactly once',
      );
    }

    const role = roles[0] as any;

    if (
      typeof role.id !== 'string' ||
      role.id.length === 0 ||
      role.organization_id !==
        organizationId ||
      role.scope !== 'organization' ||
      role.name !== 'admin_org'
    ) {
      throw new InternalServerErrorException(
        'Data integrity error: invalid bootstrap admin role',
      );
    }

    return role.id;
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
