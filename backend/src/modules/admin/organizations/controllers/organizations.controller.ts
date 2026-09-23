import { Controller, Get, Post, Param, Body, Patch, Delete, Req } from '@nestjs/common';
import { RequirePermission } from '../../../../common/decorators/require-permission.decorator';
import { PERMISSIONS } from '../../../../common/constants/permissions';
import { PlatformScope } from '../../../../common/decorators/platform-scope.decorator';
import { RequestWithAuthenticatedUser } from '../../../../common/interfaces/authenticated-user.interface';
import { OrganizationsService } from '../services/organizations.service';
import { OrganizationDto } from '../dto/organizations.dto';
import { CreateOrganizationDto } from '../dto/create-organization.dto';
import { UpdateOrganizationDto } from '../dto/update-organization.dto';
import { BootstrapOrganizationAdminDto } from '../dto/bootstrap-organization-admin.dto';

@Controller('admin/organizations')
@PlatformScope()
export class OrganizationsController {
  constructor(private organizationsService: OrganizationsService) {}

  @Get()
  @RequirePermission([PERMISSIONS.PLATFORM_ORGANIZATIONS_VIEW])
  async findAll(): Promise<OrganizationDto[]> {
    return this.organizationsService.findAll();
  }

  @Get(':id')
  @RequirePermission([PERMISSIONS.PLATFORM_ORGANIZATIONS_VIEW])
  async findOne(@Param('id') id: string): Promise<OrganizationDto> {
    return this.organizationsService.findOne(id);
  }

  @Post()
  @RequirePermission([PERMISSIONS.PLATFORM_ORGANIZATIONS_CREATE])
  async create(
    @Body() dto: CreateOrganizationDto,
    @Req() request: RequestWithAuthenticatedUser,
  ): Promise<OrganizationDto> {
    return this.organizationsService.create(dto, {
      actorUserId: request.authenticatedUser.userId,
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    });
  }

  @Patch(':id')
  @RequirePermission([PERMISSIONS.PLATFORM_ORGANIZATIONS_UPDATE])
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationDto,
    @Req() request: RequestWithAuthenticatedUser,
  ): Promise<OrganizationDto> {
    return this.organizationsService.update(id, dto, {
      actorUserId: request.authenticatedUser.userId,
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    });
  }

  @Post(':id/bootstrap-admin')
  @RequirePermission([
    PERMISSIONS.PLATFORM_ORGANIZATIONS_BOOTSTRAP_ADMIN,
  ])
  async bootstrapAdmin(
    @Param('id') id: string,
    @Body() dto: BootstrapOrganizationAdminDto,
    @Req() request: RequestWithAuthenticatedUser,
  ): Promise<{
    userId: string;
    membershipId: string;
    roleId: string;
    membershipStatus: 'active';
    provisioningPath: 'new_identity' | 'existing_identity';
  }> {
    return this.organizationsService.bootstrapAdmin(
      id,
      dto,
      {
        actorUserId:
          request.authenticatedUser.userId,
        ipAddress: request.ip,
        userAgent:
          request.get('user-agent'),
      },
    );
  }

  @Delete(':id')
  @RequirePermission([PERMISSIONS.PLATFORM_ORGANIZATIONS_DELETE])
  async delete(
    @Param('id') id: string,
    @Req() request: RequestWithAuthenticatedUser,
  ): Promise<{ message: string }> {
    await this.organizationsService.delete(id, {
      actorUserId: request.authenticatedUser.userId,
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    });

    return { message: `Organization ${id} deleted successfully` };
  }
}
