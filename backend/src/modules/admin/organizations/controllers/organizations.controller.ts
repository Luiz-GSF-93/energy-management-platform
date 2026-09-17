import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { RequirePermission } from '../../../../common/decorators/require-permission.decorator';
import { PERMISSIONS } from '../../../../common/constants/permissions';
import { OrganizationsService } from '../services/organizations.service';
import { OrganizationDto } from '../dto/organizations.dto';
import { CreateOrganizationDto } from '../dto/create-organization.dto';

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
}
