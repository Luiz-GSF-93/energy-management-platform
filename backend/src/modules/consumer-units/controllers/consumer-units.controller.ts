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

@Controller('consumer-units')
export class ConsumerUnitsController {
  constructor(private consumerUnitsService: ConsumerUnitsService) {}

  @Post()
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
  async findAll(@OrganizationId() organizationId: string) {
    return this.consumerUnitsService.findAll(organizationId);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @OrganizationId() organizationId: string,
  ) {
    return this.consumerUnitsService.findOne(id, organizationId);
  }

  @Put(':id')
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
  async delete(
    @Param('id') id: string,
    @OrganizationId() organizationId: string,
  ) {
    return this.consumerUnitsService.delete(id, organizationId);
  }
}
