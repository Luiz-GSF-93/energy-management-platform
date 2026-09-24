import { UpdateUserDetailsDto } from '../dto/update-user-details.dto';
import {
  Body,
  Controller,
  Get,
  Param,
  Delete,
  Patch,
  Post,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { RequirePermission } from '../../../../common/decorators/require-permission.decorator';
import { Tenant } from '../../../../common/decorators/tenant.decorator';
import { PERMISSIONS } from '../../../../common/constants/permissions';
import { TenantContext } from '../../../../common/interfaces/tenant-context.interface';
import { InviteUserDto } from '../dto/invite-user.dto';
import { UpdateUserAffiliationDto } from '../dto/update-user-affiliation.dto';
import { UpdateUserRoleDto } from '../dto/update-user-role.dto';
import { UsersService } from '../services/users.service';

@Controller('admin/users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Post('invite')
  @RequirePermission([PERMISSIONS.ORGANIZATION_USERS_INVITE])
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  async invite(
    @Body() dto: InviteUserDto,
    @Tenant() tenant: TenantContext,
    @Req() request: Request,
  ) {
    await this.usersService.assertAssignable(dto.roleId,tenant.organizationId,tenant.permissions,tenant.accessMode==='platform_operation');
    return this.usersService.invite(dto, {
      actorUserId: tenant.userId,
      organizationId: tenant.organizationId,
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    });
  }

  @Get()
  @RequirePermission([PERMISSIONS.ORGANIZATION_USERS_VIEW])
  async findAll(@Tenant() tenant: TenantContext) {
    return this.usersService.findAll(tenant.organizationId);
  }

  @Get('roles')
  @RequirePermission([PERMISSIONS.ORGANIZATION_USERS_VIEW])
  async roles(@Tenant() tenant:TenantContext) { return this.usersService.availableRoles(tenant.organizationId,tenant.accessMode==='platform_operation'); }

  @Patch(':userId/details')
  @RequirePermission([PERMISSIONS.ORGANIZATION_USERS_UPDATE])
  @UsePipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true}))
  async details(@Param('userId') userId:string,@Body() dto:UpdateUserDetailsDto,@Tenant() tenant:TenantContext,@Req() req:Request) {
    return this.usersService.updateDetails(userId,dto,{actorUserId:tenant.userId,organizationId:tenant.organizationId,ipAddress:req.ip,userAgent:req.get('user-agent')});
  }

  @Get(':userId')
  @RequirePermission([PERMISSIONS.ORGANIZATION_USERS_VIEW])
  async findOne(
    @Param('userId') userId: string,
    @Tenant() tenant: TenantContext,
  ) {
    return this.usersService.findOne(userId, tenant.organizationId);
  }

  @Delete(':userId')
  @RequirePermission([PERMISSIONS.ORGANIZATION_USERS_DELETE])
  async deactivate(
    @Param('userId') userId: string,
    @Tenant() tenant: TenantContext,
    @Req() request: Request,
  ) {
    return this.usersService.deactivate(userId, {
      actorUserId: tenant.userId,
      organizationId: tenant.organizationId,
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    });
  }

  @UsePipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true}))
  @Patch(':userId/role')
  @RequirePermission([PERMISSIONS.ORGANIZATION_USERS_UPDATE])
  async updateRole(
    @Param('userId') userId: string,
    @Body() dto: UpdateUserRoleDto,
    @Tenant() tenant: TenantContext,
    @Req() request: Request,
  ) {
    await this.usersService.assertAssignable(dto.roleId,tenant.organizationId,tenant.permissions,tenant.accessMode==='platform_operation');
    return this.usersService.updateRole(
      userId,
      dto.roleId,
      {
        actorUserId: tenant.userId,
        organizationId: tenant.organizationId,
        ipAddress: request.ip,
        userAgent: request.get('user-agent'),
      },
    );
  }

  @UsePipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true}))
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
