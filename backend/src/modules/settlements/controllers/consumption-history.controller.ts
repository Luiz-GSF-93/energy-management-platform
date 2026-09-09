import { Controller, Post, Get, Put, Delete, Body, Param, UseGuards, Query } from '@nestjs/common';
import { ConsumptionHistoryService } from '../services/consumption-history.service';
import { ConsumptionHistoryDto } from '../dto/consumption-history.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('consumption-history')
@UseGuards(JwtAuthGuard)
export class ConsumptionHistoryController {
  constructor(private readonly consumptionHistoryService: ConsumptionHistoryService) {}

  @Post()
  async create(@Body() dto: ConsumptionHistoryDto) {
    return this.consumptionHistoryService.create(dto);
  }

  @Get('consumer-unit/:consumerUnitId')
  async findByConsumerUnit(@Param('consumerUnitId') consumerUnitId: string) {
    return this.consumptionHistoryService.findByConsumerUnit(consumerUnitId);
  }

  @Get('consumer-unit/:consumerUnitId/trend')
  async getTrend(@Param('consumerUnitId') consumerUnitId: string, @Query('months') months: number = 12) {
    return this.consumptionHistoryService.getTrend(consumerUnitId, months);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.consumptionHistoryService.findOne(id);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: Partial<ConsumptionHistoryDto>) {
    return this.consumptionHistoryService.update(id, dto);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.consumptionHistoryService.delete(id);
  }
}
