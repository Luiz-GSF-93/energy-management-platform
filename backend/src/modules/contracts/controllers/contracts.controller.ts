import { Controller, Get, Post, Body, Param, Put, Delete, UseGuards } from '@nestjs/common';
import { ContractsService } from '../services/contracts.service';
import { Contract } from '../repositories/contract.repository';
import { JwtAuthGuard } from '../../../common/guards/jwt.guard';

@Controller('contracts')
@UseGuards(JwtAuthGuard)
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Post()
  async create(@Body() dto: Partial<Contract>) {
    return this.contractsService.create(dto);
  }

  @Get()
  async findAll() {
    return this.contractsService.findAll();
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.contractsService.findById(id);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: Partial<Contract>) {
    return this.contractsService.update(id, dto);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.contractsService.delete(id);
  }

  @Get('status/:status')
  async findByStatus(@Param('status') status: string) {
    return this.contractsService.findByStatus(status);
  }

  @Get('analytics/overview')
  async getAnalytics() {
    return this.contractsService.getAnalytics();
  }
}
