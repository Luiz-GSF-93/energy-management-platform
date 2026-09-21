import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { RequirePermission } from '../../../../common/decorators/require-permission.decorator';
import { Tenant } from '../../../../common/decorators/tenant.decorator';
import { PERMISSIONS } from '../../../../common/constants/permissions';
import { TenantContext } from '../../../../common/interfaces/tenant-context.interface';
import { UpdateUserAffiliationDto } from '../dto/update-user-affiliation.dto';
import { UsersService } from '../services/users.service';

@Controller('admin/users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  @RequirePermission([PERMISSIONS.ORGANIZATION_USERS_VIEW])
  async findAll(@Tenant() tenant: TenantContext) {
    return this.usersService.findAll(tenant.organizationId);
  }

  @Get(':userId')
  @RequirePermission([PERMISSIONS.ORGANIZATION_USERS_VIEW])
  async findOne(
    @Param('userId') userId: string,
    @Tenant() tenant: TenantContext,
  ) {
    return this.usersService.findOne(userId, tenant.organizationId);
  }

  @Patch(':userId/affiliation')
  @RequirePermission([PERMISSIONS.ORGANIZATION_USERS_UPDATE])
  async updateAffiliation(
    @Param('userId') userId: string,
    @Body() dto: UpdateUserAffiliationDto,
    @Tenant() tenant: TenantContext,
    @Req() request: Request,
  ) {
    return this.usersService.updateAffiliation(userId, dto.affiliationType, {
      actorUserId: tenant.userId,
      organizationId: tenant.organizationId,
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    });
  }
}
