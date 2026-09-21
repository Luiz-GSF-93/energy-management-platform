import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
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
  affiliationType: UserAffiliationType;
  membershipStatus: string;
  role: {
    id: string;
    name: string;
  };
  invitedAt: string | null;
  acceptedAt: string | null;
}

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
        'user_id, organization_id, role_id, status, invited_at, accepted_at, roles(id, name, organization_id, scope)',
      )
      .eq('organization_id', organizationId);

    if (membershipError) {
      throw new InternalServerErrorException(
        'Failed to load organization users',
      );
    }

    const membershipRows = (memberships || []) as UserMembershipRow[];

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
        'user_id, organization_id, role_id, status, invited_at, accepted_at, roles(id, name, organization_id, scope)',
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

    return {
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
        typeof profile.name !== 'string') ||
      !USER_AFFILIATION_TYPES.includes(
        profile.affiliation_type as UserAffiliationType,
      )
    ) {
      throw new InternalServerErrorException(
        'Data integrity error: invalid user profile',
      );
    }

    return {
      userId: membership.userId,
      email: profile.email,
      name: typeof profile.name === 'string' ? profile.name : null,
      affiliationType: profile.affiliation_type as UserAffiliationType,
      membershipStatus: membership.membershipStatus,
      role: membership.role,
      invitedAt: membership.invitedAt,
      acceptedAt: membership.acceptedAt,
    };
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

  async updateAffiliation(
    targetUserId: string,
    affiliationType: UserAffiliationType,
    auditContext: {
      actorUserId: string;
      organizationId: string;
      ipAddress?: string;
      userAgent?: string;
    },
  ): Promise<{
    userId: string;
    affiliationType: UserAffiliationType;
  }> {
    if (
      !USER_AFFILIATION_TYPES.includes(
        affiliationType as UserAffiliationType,
      )
    ) {
      throw new BadRequestException('Invalid affiliation type');
    }

    const client = this.supabaseService.getClient();

    // Target must belong actively to the actor's current organization.
    // Affiliation itself never grants organization access.
    const { data: memberships, error: membershipError } = await client
      .from('organization_members')
      .select('user_id, organization_id, status')
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
        'User not found in current organization',
      );
    }

    if (memberships.length > 1) {
      throw new InternalServerErrorException(
        'Data integrity error: multiple active target memberships found',
      );
    }

    const { data: profiles, error: profileError } = await client
      .from('user_profiles')
      .select('user_id, affiliation_type')
      .eq('user_id', targetUserId);

    if (profileError) {
      throw new InternalServerErrorException(
        'Failed to load target user profile',
      );
    }

    if (!profiles || profiles.length === 0) {
      throw new NotFoundException('User profile not found');
    }

    if (profiles.length > 1) {
      throw new InternalServerErrorException(
        'Data integrity error: multiple target profiles found',
      );
    }

    const before = profiles[0].affiliation_type as UserAffiliationType;

    // Idempotent: no DB write and no audit noise.
    if (before === affiliationType) {
      return {
        userId: targetUserId,
        affiliationType,
      };
    }

    const { data: updatedProfiles, error: updateError } = await client
      .from('user_profiles')
      .update({
        affiliation_type: affiliationType,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', targetUserId)
      .eq('affiliation_type', before)
      .select('user_id, affiliation_type');

    if (updateError) {
      throw new InternalServerErrorException(
        'Failed to update user affiliation',
      );
    }

    if (!updatedProfiles || updatedProfiles.length !== 1) {
      throw new InternalServerErrorException(
        'User affiliation changed concurrently',
      );
    }

    try {
      await this.auditService.logUserAffiliationChange({
        actorUserId: auditContext.actorUserId,
        organizationId: auditContext.organizationId,
        targetUserId,
        before,
        after: affiliationType,
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
      });
    } catch {
      // Compensate only if our written value is still current.
      // This prevents overwriting a concurrent later change.
      const { data: revertedProfiles, error: rollbackError } = await client
        .from('user_profiles')
        .update({
          affiliation_type: before,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', targetUserId)
        .eq('affiliation_type', affiliationType)
        .select('user_id');

      if (
        rollbackError ||
        !revertedProfiles ||
        revertedProfiles.length !== 1
      ) {
        throw new InternalServerErrorException(
          'Audit logging failed and affiliation rollback could not be confirmed',
        );
      }

      throw new InternalServerErrorException(
        'Audit logging failed; affiliation update reverted',
      );
    }

    return {
      userId: targetUserId,
      affiliationType,
    };
  }
}
