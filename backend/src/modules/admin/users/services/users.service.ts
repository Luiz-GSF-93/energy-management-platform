import { sendMembershipNotification, MembershipNotificationStatus } from './membership-notification';
import { PERMISSIONS } from '../../../../common/constants/permissions';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AuditService } from '../../../../common/services/audit.service';
import { SupabaseService } from '../../../../services/supabase.service';
import {
  USER_AFFILIATION_TYPES,
  UserAffiliationType,
} from '../dto/update-user-affiliation.dto';

interface UserRoleRow {
  id?: unknown;
  name?: unknown;
  organization_id?: unknown;
  scope?: unknown;
}

interface UserMembershipRow {
  user_id?: unknown;
  organization_id?: unknown;
  role_id?: unknown;
  status?: unknown;
  affiliation_type?: unknown;
  display_name?: unknown;
  invited_at?: unknown;
  accepted_at?: unknown;
  roles?: UserRoleRow | UserRoleRow[] | null;
}

interface UserProfileRow {
  user_id?: unknown;
  email?: unknown;
  name?: unknown;
  affiliation_type?: unknown;
}

export interface OrganizationUserView {
  userId: string;
  email: string;
  name: string | null;
  affiliationType: UserAffiliationType | null;
  membershipStatus: string;
  role: {
    id: string;
    name: string;
  };
  invitedAt: string | null;
  acceptedAt: string | null;
}

import { InviteUserDto } from '../dto/invite-user.dto';
@Injectable()
export class UsersService {
  constructor(
    private supabaseService: SupabaseService,
    private auditService: AuditService,
  ) {}

  async findAll(organizationId: string): Promise<OrganizationUserView[]> {
    const client = this.supabaseService.getClient();

    const { data: memberships, error: membershipError } = await client
      .from('organization_members')
      .select(
        'user_id, organization_id, role_id, status, affiliation_type, display_name, invited_at, accepted_at, roles(id, name, organization_id, scope)',
      )
      .eq('organization_id', organizationId);

    if (membershipError) {
      throw new InternalServerErrorException(
        'Failed to load organization users',
      );
    }

    // Legacy bootstrap global administrators are managed by the platform.
    // Keep tenant mutations restricted to organization roles.
    const membershipRows = ((memberships || []) as UserMembershipRow[]).filter((membership) => {
      const role = Array.isArray(membership.roles)
        ? membership.roles.length === 1 ? membership.roles[0] : null
        : membership.roles;
      return !(membership.organization_id === organizationId &&
        typeof membership.user_id === 'string' && membership.user_id.length > 0 &&
        typeof membership.role_id === 'string' && membership.role_id.length > 0 &&
        role?.id === membership.role_id && role.organization_id === organizationId &&
        role.scope === 'global' && role.name === 'admin_platform');
    });

    if (membershipRows.length === 0) {
      return [];
    }

    const validatedMemberships = membershipRows.map((membership) =>
      this.validateMembership(membership, organizationId),
    );

    const authorizedUserIds = validatedMemberships.map(
      (membership) => membership.userId,
    );

    if (new Set(authorizedUserIds).size !== authorizedUserIds.length) {
      throw new InternalServerErrorException(
        'Data integrity error: duplicate organization membership',
      );
    }

    const { data: profiles, error: profileError } = await client
      .from('user_profiles')
      .select('user_id, email, name, affiliation_type')
      .in('user_id', authorizedUserIds);

    if (profileError) {
      throw new InternalServerErrorException(
        'Failed to load organization user profiles',
      );
    }

    const profileRows = (profiles || []) as UserProfileRow[];
    const authorizedSet = new Set(authorizedUserIds);
    const profileByUserId = new Map<string, UserProfileRow>();

    for (const profile of profileRows) {
      if (
        typeof profile.user_id !== 'string' ||
        !authorizedSet.has(profile.user_id)
      ) {
        throw new InternalServerErrorException(
          'Data integrity error: unauthorized user profile returned',
        );
      }

      if (profileByUserId.has(profile.user_id)) {
        throw new InternalServerErrorException(
          'Data integrity error: multiple user profiles found',
        );
      }

      profileByUserId.set(profile.user_id, profile);
    }

    return validatedMemberships.map((membership) => {
      const profile = profileByUserId.get(membership.userId);

      if (!profile) {
        throw new InternalServerErrorException(
          'Data integrity error: user profile missing',
        );
      }

      return this.composeUserView(membership, profile);
    });
  }

  async findOne(
    targetUserId: string,
    organizationId: string,
  ): Promise<OrganizationUserView> {
    const client = this.supabaseService.getClient();

    const { data: memberships, error: membershipError } = await client
      .from('organization_members')
      .select(
        'user_id, organization_id, role_id, status, affiliation_type, display_name, invited_at, accepted_at, roles(id, name, organization_id, scope)',
      )
      .eq('user_id', targetUserId)
      .eq('organization_id', organizationId);

    if (membershipError) {
      throw new InternalServerErrorException(
        'Failed to load organization user',
      );
    }

    const membershipRows = (memberships || []) as UserMembershipRow[];

    if (membershipRows.length === 0) {
      throw new NotFoundException(
        'User not found in current organization',
      );
    }

    if (membershipRows.length > 1) {
      throw new InternalServerErrorException(
        'Data integrity error: multiple target memberships found',
      );
    }

    const membership = this.validateMembership(
      membershipRows[0],
      organizationId,
    );

    if (membership.userId !== targetUserId) {
      throw new InternalServerErrorException(
        'Data integrity error: target membership mismatch',
      );
    }

    const { data: profiles, error: profileError } = await client
      .from('user_profiles')
      .select('user_id, email, name, affiliation_type')
      .eq('user_id', targetUserId);

    if (profileError) {
      throw new InternalServerErrorException(
        'Failed to load organization user profile',
      );
    }

    const profileRows = (profiles || []) as UserProfileRow[];

    if (profileRows.length === 0) {
      throw new InternalServerErrorException(
        'Data integrity error: user profile missing',
      );
    }

    if (profileRows.length > 1) {
      throw new InternalServerErrorException(
        'Data integrity error: multiple user profiles found',
      );
    }

    if (profileRows[0].user_id !== targetUserId) {
      throw new InternalServerErrorException(
        'Data integrity error: target profile mismatch',
      );
    }

    return this.composeUserView(membership, profileRows[0]);
  }

  private validateMembership(
    membership: UserMembershipRow,
    organizationId: string,
  ): {
    userId: string;
    membershipStatus: string;
    role: { id: string; name: string };
    affiliationType: UserAffiliationType | null;
    displayName: string | null;
    invitedAt: string | null;
    acceptedAt: string | null;
  } {
    if (
      typeof membership.user_id !== 'string' ||
      typeof membership.organization_id !== 'string' ||
      membership.organization_id !== organizationId ||
      typeof membership.role_id !== 'string' ||
      membership.role_id.length === 0 ||
      typeof membership.status !== 'string'
    ) {
      throw new InternalServerErrorException(
        'Data integrity error: invalid organization membership',
      );
    }

    const role = Array.isArray(membership.roles)
      ? membership.roles.length === 1
        ? membership.roles[0]
        : null
      : membership.roles;

    if (
      !role ||
      typeof role.id !== 'string' ||
      role.id.length === 0 ||
      typeof role.name !== 'string' ||
      role.name.length === 0 ||
      typeof role.organization_id !== 'string' ||
      role.organization_id !== organizationId ||
      role.scope !== 'organization' ||
      membership.role_id !== role.id
    ) {
      throw new InternalServerErrorException(
        'Data integrity error: invalid organization role',
      );
    }

    if (
      membership.invited_at !== null &&
      membership.invited_at !== undefined &&
      typeof membership.invited_at !== 'string'
    ) {
      throw new InternalServerErrorException(
        'Data integrity error: invalid membership invitation timestamp',
      );
    }

    if (
      membership.accepted_at !== null &&
      membership.accepted_at !== undefined &&
      typeof membership.accepted_at !== 'string'
    ) {
      throw new InternalServerErrorException(
        'Data integrity error: invalid membership acceptance timestamp',
      );
    }

    if (membership.affiliation_type != null && !USER_AFFILIATION_TYPES.includes(membership.affiliation_type as UserAffiliationType)) {
      throw new InternalServerErrorException('Invalid organization affiliation');
    }
    return {
      affiliationType: (membership.affiliation_type ?? null) as UserAffiliationType | null,
      displayName: typeof membership.display_name === 'string' ? membership.display_name : null,
      userId: membership.user_id,
      membershipStatus: membership.status,
      role: {
        id: role.id,
        name: role.name,
      },
      invitedAt:
        typeof membership.invited_at === 'string'
          ? membership.invited_at
          : null,
      acceptedAt:
        typeof membership.accepted_at === 'string'
          ? membership.accepted_at
          : null,
    };
  }

  private composeUserView(
    membership: {
      userId: string;
      membershipStatus: string;
      role: { id: string; name: string };
      affiliationType: UserAffiliationType | null;
    displayName: string | null;
    invitedAt: string | null;
      acceptedAt: string | null;
    },
    profile: UserProfileRow,
  ): OrganizationUserView {
    if (
      profile.user_id !== membership.userId ||
      typeof profile.email !== 'string' ||
      profile.email.length === 0 ||
      (profile.name !== null &&
        profile.name !== undefined &&
        typeof profile.name !== 'string')
    ) {
      throw new InternalServerErrorException(
        'Data integrity error: invalid user profile',
      );
    }

    return {
      userId: membership.userId,
      email: profile.email,
      name: membership.displayName ?? (typeof profile.name === 'string' ? profile.name : null),
      affiliationType: membership.affiliationType,
      membershipStatus: membership.membershipStatus,
      role: membership.role,
      invitedAt: membership.invitedAt,
      acceptedAt: membership.acceptedAt,
    };
  }

  async deactivate(targetUserId: string, context: {
    actorUserId: string; organizationId: string; ipAddress?: string; userAgent?: string;
    actorPermissions?: string[]; platformOperation?: boolean;
  }) { return this.setMembershipStatus(targetUserId, 'inactive', context); }

  async setMembershipStatus(targetUserId: string, status: 'active' | 'inactive', context: {
    actorUserId: string; organizationId: string; ipAddress?: string; userAgent?: string;
    actorPermissions?: string[]; platformOperation?: boolean;
  }) {
    const permission = status === 'active' ? PERMISSIONS.ORGANIZATION_USERS_UPDATE : PERMISSIONS.ORGANIZATION_USERS_DELETE;
    if (!context.actorPermissions?.includes(permission)) throw new ForbiddenException('Sem permissão para alterar este acesso.');
    if (targetUserId === context.actorUserId) throw new BadRequestException('Você não pode alterar o próprio acesso por esta ação.');
    const member = await this.findOne(targetUserId, context.organizationId);
    await this.assertAssignable(member.role.id, context.organizationId, context.actorPermissions, context.platformOperation);
    const expected = status === 'active' ? 'inactive' : 'active';
    if (member.membershipStatus !== expected) throw new ConflictException('O acesso já foi alterado. Atualize a lista.');
    const {data, error} = await this.supabaseService.getClient().rpc('set_organization_member_status', {
      target_organization_id: context.organizationId, target_user_id: targetUserId,
      actor_user_id: context.actorUserId, target_status: status, expected_status: expected,
      expected_role_id: member.role.id, audit_ip: context.ipAddress || null, audit_agent: context.userAgent || null,
    });
    if (error) {
      if (error.code === '42501') throw new ForbiddenException('Sem permissão para alterar este acesso.');
      if (error.code === 'P3230') throw new NotFoundException('Usuário não encontrado nesta organização.');
      if (error.code === 'P3231') throw new ConflictException('O acesso ou a função mudou. Atualize a lista.');
      if (error.code === 'P3232') throw new BadRequestException('Mantenha ao menos um Administrador da organização ou Gestor ativo.');
      if(error.code==='P3392')throw new BadRequestException('Solicite ao administrador da plataforma a vinculação da licença a um plano.');
      if(error.code==='P3390')throw new BadRequestException('É necessária uma licença ativa para reativar usuários.');
      if (['P3152','P3391'].includes(error.code)) throw new BadRequestException('O limite de usuários ativos da licença foi atingido.');
      throw new InternalServerErrorException('Não foi possível alterar o acesso. Nenhuma alteração foi confirmada.');
    }
    if (data !== true) throw new InternalServerErrorException('Não foi possível confirmar a alteração do acesso. Atualize a lista.');
    if (status === 'active') {
      // Distinct key for each confirmed reactivation, separate from the original invitation.
      const notificationStatus = await this.notifyMembership(randomUUID(), member.email, context.organizationId, member.role.name, member.affiliationType || 'internal', 'reactivated');
      return {userId: targetUserId, membershipStatus: status, notificationStatus};
    }
    return {userId: targetUserId, membershipStatus: status};
  }

  async updateRole(
    targetUserId: string,
    requestedRoleId: string,
    auditContext: {
      actorUserId: string;
      organizationId: string;
      ipAddress?: string;
      userAgent?: string;
    },
  ): Promise<{
    userId: string;
    role: { id: string; name: string };
  }> {
    const client = this.supabaseService.getClient();

    const { data: memberships, error: membershipError } = await client
      .from('organization_members')
      .select(
        'id, user_id, organization_id, role_id, status, roles(id, name, organization_id, scope)',
      )
      .eq('user_id', targetUserId)
      .eq('organization_id', auditContext.organizationId)
      .eq('status', 'active');

    if (membershipError) {
      throw new InternalServerErrorException(
        'Failed to validate target organization membership',
      );
    }

    if (!memberships || memberships.length === 0) {
      throw new NotFoundException(
        'Active organization membership not found',
      );
    }

    if (memberships.length !== 1) {
      throw new InternalServerErrorException(
        'Data integrity error: multiple active organization memberships',
      );
    }

    const membership = memberships[0] as any;

    if (
      typeof membership.id !== 'string' ||
      membership.id.length === 0 ||
      typeof membership.user_id !== 'string' ||
      membership.user_id !== targetUserId ||
      typeof membership.organization_id !== 'string' ||
      membership.organization_id !== auditContext.organizationId ||
      membership.status !== 'active' ||
      typeof membership.role_id !== 'string' ||
      membership.role_id.length === 0
    ) {
      throw new InternalServerErrorException(
        'Data integrity error: invalid organization membership',
      );
    }

    const currentRole = Array.isArray(membership.roles)
      ? membership.roles.length === 1
        ? membership.roles[0]
        : null
      : membership.roles;

    if (
      !currentRole ||
      typeof currentRole.id !== 'string' ||
      currentRole.id !== membership.role_id ||
      typeof currentRole.name !== 'string' ||
      currentRole.name.length === 0 ||
      typeof currentRole.organization_id !== 'string' ||
      currentRole.organization_id !== auditContext.organizationId ||
      currentRole.scope !== 'organization'
    ) {
      throw new InternalServerErrorException(
        'Data integrity error: invalid current organization role',
      );
    }

    const { data: destinationRoles, error: destinationRoleError } =
      await client
        .from('roles')
        .select('id, name, organization_id, scope')
        .eq('id', requestedRoleId);

    if (destinationRoleError) {
      throw new InternalServerErrorException(
        'Failed to validate destination role',
      );
    }

    if (!destinationRoles || destinationRoles.length === 0) {
      throw new NotFoundException('Destination role not found');
    }

    if (destinationRoles.length !== 1) {
      throw new InternalServerErrorException(
        'Data integrity error: multiple destination roles',
      );
    }

    const destinationRole = destinationRoles[0] as any;

    if (
      typeof destinationRole.id !== 'string' ||
      destinationRole.id !== requestedRoleId ||
      typeof destinationRole.name !== 'string' ||
      destinationRole.name.length === 0 ||
      typeof destinationRole.organization_id !== 'string' ||
      destinationRole.organization_id !== auditContext.organizationId ||
      destinationRole.scope !== 'organization'
    ) {
      throw new BadRequestException(
        'Destination role is not valid for the active organization',
      );
    }

    const beforeRoleId = membership.role_id;

    if (beforeRoleId === requestedRoleId) {
      return {
        userId: targetUserId,
        role: {
          id: destinationRole.id,
          name: destinationRole.name,
        },
      };
    }

    const { data: updatedMemberships, error: updateError } = await client
      .from('organization_members')
      .update({ role_id: requestedRoleId })
      .eq('user_id', targetUserId)
      .eq('organization_id', auditContext.organizationId)
      .eq('status', 'active')
      .eq('role_id', beforeRoleId)
      .select('id, user_id, organization_id, role_id, status');

    if (updateError) {
      throw new InternalServerErrorException(
        'Failed to update organization membership role',
      );
    }

    if (!updatedMemberships || updatedMemberships.length !== 1) {
      throw new InternalServerErrorException(
        'Concurrent or invalid organization membership role update',
      );
    }

    const updatedMembership = updatedMemberships[0] as any;

    if (
      updatedMembership.id !== membership.id ||
      updatedMembership.user_id !== targetUserId ||
      updatedMembership.organization_id !== auditContext.organizationId ||
      updatedMembership.status !== 'active' ||
      updatedMembership.role_id !== requestedRoleId
    ) {
      throw new InternalServerErrorException(
        'Data integrity error: invalid updated organization membership',
      );
    }

    try {
      await this.auditService.logUserMembershipRoleChange({
        actorUserId: auditContext.actorUserId,
        organizationId: auditContext.organizationId,
        targetUserId,
        membershipId: membership.id,
        beforeRoleId,
        afterRoleId: requestedRoleId,
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
      });
    } catch {
      const { data: revertedMemberships, error: rollbackError } = await client
        .from('organization_members')
        .update({ role_id: beforeRoleId })
        .eq('user_id', targetUserId)
        .eq('organization_id', auditContext.organizationId)
        .eq('status', 'active')
        .eq('role_id', requestedRoleId)
        .select('id, role_id');

      if (
        rollbackError ||
        !revertedMemberships ||
        revertedMemberships.length !== 1 ||
        revertedMemberships[0]?.id !== membership.id ||
        revertedMemberships[0]?.role_id !== beforeRoleId
      ) {
        throw new InternalServerErrorException(
          'CRITICAL: Role audit failed and rollback could not be confirmed. Admin intervention required.',
        );
      }

      throw new InternalServerErrorException(
        'Role audit failed. Membership role update was reverted.',
      );
    }

    return {
      userId: targetUserId,
      role: {
        id: destinationRole.id,
        name: destinationRole.name,
      },
    };
  }


  async invite(
    dto: InviteUserDto,
    auditContext: {
      actorUserId: string;
      organizationId: string;
      ipAddress?: string;
      userAgent?: string;
    },
  ): Promise<{
    userId: string;
    membershipId: string;
    membershipStatus: 'active';
    provisioningPath: 'new_identity' | 'existing_identity';
    notificationStatus?: MembershipNotificationStatus;
  }> {
    const client = this.supabaseService.getClient();
    const authClient = this.supabaseService.createAuthClient();

    const normalizedEmail = dto.email.trim().toLowerCase();
    const normalizedName = dto.name.trim();

    let createdIdentity = false;
    let createdProfile = false;
    let createdMembership = false;
    let compensationAttempted = false;

    let targetUserId: string | null = null;
    let membershipId: string | null = null;
    let provisioningPath: 'new_identity' | 'existing_identity' =
      'existing_identity';

    const compensate = async (): Promise<void> => {
      compensationAttempted = true;

      const failures: string[] = [];

      if (createdMembership && membershipId && targetUserId) {
        try {
          const { data, error } = await client
            .from('organization_members')
            .delete()
            .eq('id', membershipId)
            .eq('user_id', targetUserId)
            .eq('organization_id', auditContext.organizationId)
            .select('id');

          if (
            error ||
            !data ||
            data.length !== 1 ||
            data[0]?.id !== membershipId
          ) {
            failures.push('membership');
          }
        } catch {
          failures.push('membership');
        }
      }

      if (createdProfile && targetUserId) {
        try {
          const { data, error } = await client
            .from('user_profiles')
            .delete()
            .eq('user_id', targetUserId)
            .eq('email', normalizedEmail)
            .select('user_id');

          if (
            error ||
            !data ||
            data.length !== 1 ||
            data[0]?.user_id !== targetUserId
          ) {
            failures.push('profile');
          }
        } catch {
          failures.push('profile');
        }
      }

      if (createdIdentity && targetUserId) {
        try {
          const { error } =
            await authClient.auth.admin.deleteUser(targetUserId);

          if (error) {
            failures.push('identity');
          }
        } catch {
          failures.push('identity');
        }
      }

      if (failures.length > 0) {
        throw new InternalServerErrorException(
          `CRITICAL: invite compensation could not be confirmed for ${failures.join(
            ', ',
          )}`,
        );
      }
    };

    try {
      // Destination role is tenant-scoped and membership.role_id is the
      // organization role authority.
      const { data: roles, error: roleError } = await client
        .from('roles')
        .select('id, name, organization_id, scope')
        .eq('id', dto.roleId)
        .eq('organization_id', auditContext.organizationId)
        .eq('scope', 'organization');

      if (roleError) {
        throw new InternalServerErrorException(
          'Failed to validate destination organization role',
        );
      }

      if (!roles || roles.length === 0) {
        throw new BadRequestException(
          'Destination role is not valid for the active organization',
        );
      }

      if (roles.length !== 1) {
        throw new InternalServerErrorException(
          'Data integrity error: multiple destination roles found',
        );
      }

      const role = roles[0] as any;

      if (
        !role ||
        role.id !== dto.roleId ||
        role.organization_id !== auditContext.organizationId ||
        role.scope !== 'organization'
      ) {
        throw new BadRequestException(
          'Destination role is not valid for the active organization',
        );
      }

      // Profile-first lookup is the preferred identity resolution path.
      const { data: profiles, error: profileLookupError } = await client
        .from('user_profiles')
        .select(
          'user_id, email, name, organization_id, affiliation_type',
        )
        .eq('email', normalizedEmail);

      if (profileLookupError) {
        throw new InternalServerErrorException(
          'Failed to resolve invite target profile',
        );
      }

      if (profiles && profiles.length > 1) {
        throw new InternalServerErrorException(
          'Data integrity error: multiple profiles found for invite email',
        );
      }

      let profile: any = profiles?.[0] ?? null;

      if (profile) {
        if (
          typeof profile.user_id !== 'string' ||
          profile.user_id.length === 0 ||
          typeof profile.email !== 'string' ||
          profile.email.trim().toLowerCase() !== normalizedEmail
        ) {
          throw new InternalServerErrorException(
            'Data integrity error: invalid invite target profile',
          );
        }

        const {
          data: { user },
          error: authLookupError,
        } = await authClient.auth.admin.getUserById(profile.user_id);

        if (
          authLookupError ||
          !user ||
          user.id !== profile.user_id ||
          typeof user.email !== 'string' ||
          user.email.trim().toLowerCase() !== normalizedEmail
        ) {
          throw new InternalServerErrorException(
            'Invite target identity/profile integrity mismatch',
          );
        }

        targetUserId = user.id;
      } else {
        // No profile: bounded, paginated Auth lookup.
        const perPage = 100;
        const maxPages = 20;
        let authMatch: any = null;
        let authLookupComplete = false;

        for (let page = 1; page <= maxPages; page += 1) {
          const { data, error } = await authClient.auth.admin.listUsers({
            page,
            perPage,
          });

          if (error) {
            throw new InternalServerErrorException(
              'Failed to resolve invite target identity',
            );
          }

          const users = Array.isArray(data?.users) ? data.users : [];
          const matches = users.filter(
            (user: any) =>
              typeof user?.email === 'string' &&
              user.email.trim().toLowerCase() === normalizedEmail,
          );

          if (matches.length > 1 || (authMatch && matches.length > 0)) {
            throw new InternalServerErrorException(
              'Data integrity error: multiple auth identities found for invite email',
            );
          }

          if (matches.length === 1) {
            authMatch = matches[0];
          }

          const lastPage =
            typeof data?.lastPage === 'number' ? data.lastPage : null;

          if (lastPage !== null && page >= lastPage) {
            authLookupComplete = true;
            break;
          }

          if (users.length < perPage && lastPage === null) {
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
          // Approved fail-closed state: identity without profile requires
          // a separate recovery workflow.
          throw new ConflictException(
            'Existing identity has no valid user profile',
          );
        }

        const { data: inviteData, error: inviteError } =
          await authClient.auth.admin.inviteUserByEmail(normalizedEmail, {
            data: {
              name: normalizedName,
            },
            redirectTo: new URL('/auth/accept-invite', process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'http://localhost:3000').toString(),
          });

        if (
          inviteError ||
          !inviteData?.user ||
          typeof inviteData.user.id !== 'string' ||
          inviteData.user.id.length === 0 ||
          typeof inviteData.user.email !== 'string' ||
          inviteData.user.email.trim().toLowerCase() !== normalizedEmail
        ) {
          throw new InternalServerErrorException(
            'Failed to create invited user identity',
          );
        }

        targetUserId = inviteData.user.id;
        createdIdentity = true;
        provisioningPath = 'new_identity';

        const { data: insertedProfiles, error: profileInsertError } =
          await client
            .from('user_profiles')
            .insert({
              // The deployed profile primary key is text NOT NULL without a default.
              id: randomUUID(),
              user_id: targetUserId,
              email: normalizedEmail,
              name: normalizedName,
              organization_id: auditContext.organizationId,
              affiliation_type: dto.affiliationType,
            })
            .select(
              'user_id, email, organization_id, affiliation_type',
            );

        if (
          profileInsertError ||
          !insertedProfiles ||
          insertedProfiles.length !== 1 ||
          insertedProfiles[0]?.user_id !== targetUserId ||
          typeof insertedProfiles[0]?.email !== 'string' ||
          insertedProfiles[0].email.trim().toLowerCase() !== normalizedEmail ||
          insertedProfiles[0]?.organization_id !== auditContext.organizationId ||
          insertedProfiles[0]?.affiliation_type !== dto.affiliationType
        ) {
          throw new InternalServerErrorException(
            'Failed to provision invited user profile',
          );
        }

        createdProfile = true;
        profile = insertedProfiles[0];
      }

      if (!targetUserId || !profile) {
        throw new InternalServerErrorException(
          'Invite target resolution failed',
        );
      }

      // Invite never rewrites an existing profile name or organization pointer.
      const { data: memberships, error: membershipLookupError } =
        await client
          .from('organization_members')
          .select('id, user_id, organization_id, role_id, status')
          .eq('user_id', targetUserId)
          .eq('organization_id', auditContext.organizationId);

      if (membershipLookupError) {
        throw new InternalServerErrorException(
          'Failed to validate existing organization membership',
        );
      }

      if (memberships && memberships.length > 1) {
        throw new InternalServerErrorException(
          'Data integrity error: multiple organization memberships found',
        );
      }

      if (memberships && memberships.length === 1) {
        const existing = memberships[0] as any;

        if (
          existing.user_id !== targetUserId ||
          existing.organization_id !== auditContext.organizationId
        ) {
          throw new InternalServerErrorException(
            'Data integrity error: invalid organization membership',
          );
        }

        if (existing.status === 'active') {
          throw new ConflictException(
            'User already has an active membership in this organization',
          );
        }

        if (existing.status === 'inactive') {
          throw new ConflictException(
            'Inactive membership requires a separate reactivation workflow',
          );
        }

        throw new InternalServerErrorException(
          'Data integrity error: invalid organization membership status',
        );
      }

      const { data: insertedMemberships, error: membershipInsertError } =
        await client
          .from('organization_members')
          .insert({
            user_id: targetUserId,
            organization_id: auditContext.organizationId,
            role_id: dto.roleId,
            affiliation_type: dto.affiliationType,
            display_name: normalizedName,
            invited_at: new Date().toISOString(),
            status: 'active',
          })
          .select(
            'id, user_id, organization_id, role_id, status',
          );

      if (membershipInsertError) {
        if ((membershipInsertError as any)?.code === 'P3392')throw new ConflictException('Solicite ao administrador da plataforma a vinculação da licença a um plano.');
        if ((membershipInsertError as any)?.code === 'P3390')throw new ConflictException('É necessária uma licença ativa para cadastrar usuários.');
        if (['P3152','P3391'].includes((membershipInsertError as any)?.code)) {
          throw new ConflictException('O limite de usuários da licença foi atingido nesta organização.');
        }
        if ((membershipInsertError as any)?.code === '23505') {
          throw new ConflictException(
            'Organization membership was created concurrently',
          );
        }

        throw new InternalServerErrorException(
          'Failed to provision organization membership',
        );
      }

      if (
        !insertedMemberships ||
        insertedMemberships.length !== 1
      ) {
        throw new InternalServerErrorException(
          'Organization membership provisioning could not be confirmed',
        );
      }

      const insertedMembership = insertedMemberships[0] as any;

      if (
        typeof insertedMembership.id !== 'string' ||
        insertedMembership.id.length === 0 ||
        insertedMembership.user_id !== targetUserId ||
        insertedMembership.organization_id !==
          auditContext.organizationId ||
        insertedMembership.role_id !== dto.roleId ||
        insertedMembership.status !== 'active'
      ) {
        throw new InternalServerErrorException(
          'Organization membership provisioning integrity violation',
        );
      }

      const confirmedMembershipId: string = insertedMembership.id;

      membershipId = confirmedMembershipId;
      createdMembership = true;

      try {
        await this.auditService.logUserInvite({
          actorUserId: auditContext.actorUserId,
          organizationId: auditContext.organizationId,
          targetUserId,
          membershipId: confirmedMembershipId,
          email: normalizedEmail,
          roleId: dto.roleId,
          affiliationType: dto.affiliationType,
          provisioningPath,
          ipAddress: auditContext.ipAddress,
          userAgent: auditContext.userAgent,
        });
      } catch {
        await compensate();

        throw new InternalServerErrorException(
          'Invite audit failed; provisioning was reverted',
        );
      }

      return {
        userId: targetUserId,
        membershipId: confirmedMembershipId,
        membershipStatus: 'active',
        provisioningPath,
        ...(provisioningPath === 'existing_identity' ? {notificationStatus: await this.notifyMembership(confirmedMembershipId, normalizedEmail, auditContext.organizationId, role.name, dto.affiliationType)} : {}),
      };
    } catch (error) {
      // Compensate owned writes at most once per invite execution.
      // A prior compensation attempt may itself have failed; retrying the
      // whole rollback could delete resources twice or obscure its outcome.
      if (
        !compensationAttempted &&
        (
          createdIdentity ||
          createdProfile ||
          createdMembership
        )
      ) {
        await compensate();
      }

      throw error;
    }
  }

  private async notifyMembership(membershipId: string, email: string, organizationId: string, roleName: string, affiliationType: string, event?: 'reactivated'): Promise<MembershipNotificationStatus> {
    // Notification is best-effort after the membership audit succeeds. Never roll back access on mail failure.
    try {
      const {data,error} = await this.supabaseService.getClient().from('organizations').select('id,name').eq('id',organizationId);
      if(error || data?.length!==1 || data[0].id!==organizationId || typeof data[0].name!=='string') return 'failed';
      return await sendMembershipNotification({membershipId,email,organizationName:data[0].name,roleName,affiliationType,event});
    } catch {return 'failed';}
  }

  async notifyExistingMember(userId: string, context: {organizationId:string; actorPermissions:string[]; platformOperation:boolean}) {
    const member=await this.findOne(userId,context.organizationId);
    if(member.membershipStatus!=='active') throw new BadRequestException('O vínculo deve estar ativo para enviar o aviso.');
    await this.assertAssignable(member.role.id,context.organizationId,context.actorPermissions,context.platformOperation);
    const {data,error}=await this.supabaseService.getClient().from('organization_members').select('id').eq('user_id',userId).eq('organization_id',context.organizationId).eq('status','active').eq('role_id',member.role.id);
    if(error || data?.length!==1 || typeof data[0].id!=='string') throw new ConflictException('O vínculo mudou. Atualize a lista.');
    return {notificationStatus:await this.notifyMembership(data[0].id,member.email,context.organizationId,member.role.name,member.affiliationType || 'internal')};
  }

  async assertAssignable(roleId:string,organizationId:string,actorPermissions:string[],platformOperation=false) {
    const {data,error}=await this.supabaseService.getClient().from('roles').select('id,name,organization_id,scope,permissions').eq('id',roleId).eq('organization_id',organizationId).eq('scope','organization');
    if(error) throw new InternalServerErrorException('Failed to check role assignment');
    if(data?.some((r: {name?: string})=>r.name==='admin_org') && !platformOperation) throw new BadRequestException('Somente o administrador da plataforma pode atribuir Administrador da organização.');
    if(!data || data.length!==1 || !Array.isArray(data[0].permissions) || data[0].permissions.some((p:string)=>!actorPermissions.includes(p))) throw new BadRequestException('Você não pode atribuir uma função com permissões superiores às suas.');
  }

  async availableRoles(organizationId: string,platformOperation=false,actorPermissions:string[]=[]) {
    const {data,error}=await this.supabaseService.getClient().from('roles').select('id,name,organization_id,scope,permissions').eq('organization_id',organizationId).eq('scope','organization');
    if(error || !Array.isArray(data) || data.some(r=>r.organization_id!==organizationId || r.scope!=='organization')) throw new InternalServerErrorException('Failed to load organization roles');
    return data.filter(r=>(platformOperation || r.name!=='admin_org') && Array.isArray(r.permissions) && r.permissions.every((p:string)=>actorPermissions.includes(p))).map(r=>({id:r.id,name:r.name}));
  }

  async updateAffiliation(targetUserId: string, affiliationType: UserAffiliationType, auditContext: {actorUserId:string;organizationId:string;ipAddress?:string;userAgent?:string}) {
    await this.updateDetails(targetUserId,{affiliationType},auditContext);
    return {userId:targetUserId,affiliationType};
  }

  async updateDetails(targetUserId:string, dto:{affiliationType:UserAffiliationType;name?:string}, context:{actorUserId:string;organizationId:string;ipAddress?:string;userAgent?:string}) {
    if(!USER_AFFILIATION_TYPES.includes(dto.affiliationType)) throw new BadRequestException('Invalid affiliation type');
    const {data,error}=await this.supabaseService.getClient().rpc('update_organization_member_details',{
      target_organization_id:context.organizationId,target_user_id:targetUserId,actor_user_id:context.actorUserId,
      target_affiliation:dto.affiliationType,target_name:dto.name?.trim() ?? null,
      audit_ip:context.ipAddress ?? null,audit_agent:context.userAgent ?? null,
    });
    if(error?.code==='P3130') throw new NotFoundException('Active organization membership not found');
    if(error || data!==true) throw new InternalServerErrorException('Failed to update organization user details');
    return {userId:targetUserId,affiliationType:dto.affiliationType};
  }
}
