import { Controller, Get, Param } from '@nestjs/common';
import { RequirePermission } from '../../../../common/decorators/require-permission.decorator';
import { PERMISSIONS } from '../../../../common/constants/permissions';
import { OrganizationsService } from '../services/organizations.service';
import { OrganizationDto } from '../dto/organizations.dto';

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
}
