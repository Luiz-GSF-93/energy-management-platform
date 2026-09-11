import { Controller, Get, Post, Body, Param, Put, UseGuards } from '@nestjs/common';
import { ManagementFeesService } from '../services/management-fees.service';
import { Fee } from '../repositories/fee.repository';
import { JwtAuthGuard } from '../../../common/guards/jwt.guard';

@Controller('fees')
@UseGuards(JwtAuthGuard)
export class ManagementFeesController {
  constructor(private readonly feesService: ManagementFeesService) {}

  @Post()
  async create(@Body() dto: Partial<Fee>) {
    return this.feesService.create(dto);
  }

  @Get()
  async findAll() {
    return this.feesService.findAll();
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.feesService.findById(id);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: Partial<Fee>) {
    return this.feesService.update(id, dto);
  }

  @Get('status/:status')
  async findByStatus(@Param('status') status: string) {
    return this.feesService.findByStatus(status);
  }

  @Get('contract/:contractId')
  async findByContractId(@Param('contractId') contractId: string) {
    return this.feesService.findByContractId(contractId);
  }

  @Get('analytics/overview')
  async getAnalytics() {
    return this.feesService.getAnalytics();
  }

  @Put(':id/status')
  async updateStatus(@Param('id') id: string, @Body() body: { status: string }) {
    return this.feesService.updateStatus(id, body.status);
  }
}
