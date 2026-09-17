import { Controller, Get, Post, Param, Body, Patch, Delete, Req } from '@nestjs/common';
import { Request } from 'express';
import { RequirePermission } from '../../../../common/decorators/require-permission.decorator';
import { PERMISSIONS } from '../../../../common/constants/permissions';
import { Tenant } from '../../../../common/decorators/tenant.decorator';
import { TenantContext } from '../../../../common/interfaces/tenant-context.interface';
import { OrganizationsService } from '../services/organizations.service';
import { OrganizationDto } from '../dto/organizations.dto';
import { CreateOrganizationDto } from '../dto/create-organization.dto';
import { UpdateOrganizationDto } from '../dto/update-organization.dto';

@Controller('admin/organizations')
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
  async create(@Body() dto: CreateOrganizationDto): Promise<OrganizationDto> {
    return this.organizationsService.create(dto);
  }

  @Patch(':id')
  @RequirePermission([PERMISSIONS.PLATFORM_ORGANIZATIONS_UPDATE])
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationDto,
  ): Promise<OrganizationDto> {
    return this.organizationsService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission([PERMISSIONS.PLATFORM_ORGANIZATIONS_DELETE])
  async delete(
    @Param('id') id: string,
    @Tenant() tenant: TenantContext,
    @Req() request: Request,
  ): Promise<{ message: string }> {
    await this.organizationsService.delete(id, {
      userId: tenant.userId,
      organizationId: tenant.organizationId,
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    });

    return { message: `Organization ${id} deleted successfully` };
  }
}
