import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
} from '@nestjs/common';
import { ConsumerUnitsService } from '../services/consumer-units.service';
import { CreateConsumerUnitDto, UpdateConsumerUnitDto } from '../dto/create-consumer-unit.dto';
import { OrganizationId } from '../../../common/decorators/tenant.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { PERMISSIONS } from '../../../common/constants/permissions';

@Controller('consumer-units')
export class ConsumerUnitsController {
  constructor(private consumerUnitsService: ConsumerUnitsService) {}

  @Post()
  @RequirePermission([PERMISSIONS.ORGANIZATION_CONSUMER_UNITS_CREATE])
  async create(
    @Body() createConsumerUnitDto: CreateConsumerUnitDto,
    @OrganizationId() organizationId: string,
  ) {
    return this.consumerUnitsService.create(
      createConsumerUnitDto,
      organizationId,
    );
  }

  @Get()
  @RequirePermission([PERMISSIONS.ORGANIZATION_CONSUMER_UNITS_VIEW])
  async findAll(@OrganizationId() organizationId: string) {
    return this.consumerUnitsService.findAll(organizationId);
  }

  @Get(':id')
  @RequirePermission([PERMISSIONS.ORGANIZATION_CONSUMER_UNITS_VIEW])
  async findOne(
    @Param('id') id: string,
    @OrganizationId() organizationId: string,
  ) {
    return this.consumerUnitsService.findOne(id, organizationId);
  }

  @Put(':id')
  @RequirePermission([PERMISSIONS.ORGANIZATION_CONSUMER_UNITS_UPDATE])
  async update(
    @Param('id') id: string,
    @Body() updateConsumerUnitDto: UpdateConsumerUnitDto,
    @OrganizationId() organizationId: string,
  ) {
    return this.consumerUnitsService.update(
      id,
      organizationId,
      updateConsumerUnitDto,
    );
  }

  @Delete(':id')
  @RequirePermission([PERMISSIONS.ORGANIZATION_CONSUMER_UNITS_DELETE])
  async delete(
    @Param('id') id: string,
    @OrganizationId() organizationId: string,
  ) {
    return this.consumerUnitsService.delete(id, organizationId);
  }
}
