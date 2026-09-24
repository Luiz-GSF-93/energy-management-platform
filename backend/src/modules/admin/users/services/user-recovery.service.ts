import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { TenantContext } from '../../../../common/interfaces/tenant-context.interface';
import { PasswordRecoveryService } from '../../../auth/password-recovery.service';
import { UsersService } from './users.service';

@Injectable()
export class UserRecoveryService {
  private readonly logger = new Logger(UserRecoveryService.name);
  constructor(private readonly users: UsersService, private readonly recovery: PasswordRecoveryService) {}

  async request(targetUserId: string, tenant: TenantContext, ip: string) {
    const user = await this.users.findOne(targetUserId, tenant.organizationId);
    if (user.membershipStatus !== 'active') throw new BadRequestException('O vínculo deste usuário está inativo nesta organização.');
    if (targetUserId !== tenant.userId) {
      try {
        await this.users.assertAssignable(user.role.id, tenant.organizationId, tenant.permissions, tenant.accessMode === 'platform_operation');
      } catch (error) {
        if (error instanceof BadRequestException) throw new ForbiddenException('Você não pode solicitar recuperação para este perfil.');
        throw error;
      }
    }
    // Never accept the recipient or redirect from request input.
    const event = { event: 'organization_user_recovery', actorUserId: tenant.userId, organizationId: tenant.organizationId, targetUserId };
    try {
      const response = await this.recovery.requestManaged(user.email, ip);
      this.logger.log(JSON.stringify({ ...event, outcome: 'provider_accepted' }));
      return response;
    } catch (error) {
      this.logger.warn(JSON.stringify({ ...event, outcome: 'not_confirmed' }));
      throw error;
    }
  }
}
