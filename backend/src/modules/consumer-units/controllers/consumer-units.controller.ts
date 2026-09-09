import { Controller, Get, Post, Body, Param, Put, Delete, UseGuards, Query } from '@nestjs/common';
import { ConsumerUnitsService } from '../services/consumer-units.service';
import { CreateConsumerUnitDto, UpdateConsumerUnitDto } from '../dto/create-consumer-unit.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('consumer-units')
@UseGuards(JwtAuthGuard)
export class ConsumerUnitsController {
  constructor(private consumerUnitsService: ConsumerUnitsService) {}

  @Post()
  create(@Body() createConsumerUnitDto: CreateConsumerUnitDto) {
    return this.consumerUnitsService.create(createConsumerUnitDto);
  }

  @Get()
  findByCustomer(@Query('customerId') customerId: string) {
    return this.consumerUnitsService.findByCustomer(customerId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.consumerUnitsService.findOne(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() updateConsumerUnitDto: UpdateConsumerUnitDto) {
    return this.consumerUnitsService.update(id, updateConsumerUnitDto);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.consumerUnitsService.delete(id);
  }
}
