import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Request } from 'express';
import { Tenant } from '../../../../common/decorators/tenant.decorator';
import { RequirePermission } from '../../../../common/decorators/require-permission.decorator';
import { PERMISSIONS } from '../../../../common/constants/permissions';
import { TenantContext } from '../../../../common/interfaces/tenant-context.interface';
import { UserRecoveryService } from '../services/user-recovery.service';

export class UserRecoveryRequestDto {}

@Controller('admin/users')
export class UserRecoveryController {
  constructor(private readonly recovery: UserRecoveryService) {}

  @Post(':userId/recovery-email')
  @HttpCode(200)
  @RequirePermission([PERMISSIONS.ORGANIZATION_USERS_UPDATE])
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  request(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() _dto: UserRecoveryRequestDto,
    @Tenant() tenant: TenantContext,
    @Req() request: Request,
  ) {
    return this.recovery.request(userId, tenant, request.ip || request.socket?.remoteAddress || 'unknown');
  }
}
