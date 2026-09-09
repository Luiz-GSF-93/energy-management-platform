import { Controller, Post, Get, Put, Delete, Body, Param, UseGuards, Query } from '@nestjs/common';
import { TariffService } from '../services/tariff.service';
import { TariffDto } from '../dto/tariff.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('tariffs')
@UseGuards(JwtAuthGuard)
export class TariffController {
  constructor(private readonly tariffService: TariffService) {}

  @Post()
  async create(@Body() dto: TariffDto) {
    return this.tariffService.create(dto);
  }

  @Get('contract/:contractId/latest')
  async getLatestByContract(@Param('contractId') contractId: string) {
    return this.tariffService.getLatestByContract(contractId);
  }

  @Get()
  async findAll() {
    return this.tariffService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.tariffService.findOne(id);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: Partial<TariffDto>) {
    return this.tariffService.update(id, dto);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.tariffService.delete(id);
  }
}
