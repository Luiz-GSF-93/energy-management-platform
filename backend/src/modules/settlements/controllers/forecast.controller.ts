import { Controller, Post, Get, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ForecastService } from '../services/forecast.service';
import { ForecastDto } from '../dto/forecast.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('forecasts')
@UseGuards(JwtAuthGuard)
export class ForecastController {
  constructor(private readonly forecastService: ForecastService) {}

  @Post()
  async create(@Body() dto: ForecastDto) {
    return this.forecastService.create(dto);
  }

  @Post(':consumerUnitId/generate')
  async generate(@Param('consumerUnitId') consumerUnitId: string) {
    return this.forecastService.generateForecast(consumerUnitId);
  }

  @Get('consumer-unit/:consumerUnitId')
  async findByConsumerUnit(@Param('consumerUnitId') consumerUnitId: string) {
    return this.forecastService.findByConsumerUnit(consumerUnitId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.forecastService.findOne(id);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: Partial<ForecastDto>) {
    return this.forecastService.update(id, dto);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.forecastService.delete(id);
  }
}
