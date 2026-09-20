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

@Injectable()
export class UsersService {
  constructor(
    private supabaseService: SupabaseService,
    private auditService: AuditService,
  ) {}

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
