import { Controller, Post, Get, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { SettlementService } from '../services/settlement.service';
import { CreateSettlementDto } from '../dto/create-settlement.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('settlements')
@UseGuards(JwtAuthGuard)
export class SettlementController {
  constructor(private readonly settlementService: SettlementService) {}

  @Post()
  async create(@Body() dto: CreateSettlementDto) {
    return this.settlementService.create(dto);
  }

  @Get('consumer-unit/:consumerUnitId')
  async findByConsumerUnit(@Param('consumerUnitId') consumerUnitId: string) {
    return this.settlementService.findByConsumerUnit(consumerUnitId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.settlementService.findOne(id);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: Partial<CreateSettlementDto>) {
    return this.settlementService.update(id, dto);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.settlementService.delete(id);
  }
}
