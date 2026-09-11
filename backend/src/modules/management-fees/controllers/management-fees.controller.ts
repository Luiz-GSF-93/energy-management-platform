import { Controller, Get, Post, Body, Param, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ManagementFeesService } from '../services/management-fees.service';
import { CreateFeeDto } from '../dtos/create-fee.dto';

@Controller('api/v1/fees')
@UseGuards(JwtAuthGuard)
export class ManagementFeesController {
  constructor(private readonly feesService: ManagementFeesService) {}

  @Post()
  create(@Body() createFeeDto: CreateFeeDto) {
    return this.feesService.create(createFeeDto);
  }

  @Get()
  findAll(@Query('status') status?: string) {
    if (status && ['PENDING', 'APPROVED', 'REJECTED', 'PAID'].includes(status)) {
      return this.feesService.findByStatus(status as any);
    }
    return this.feesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.feesService.findOne(id);
  }

  @Get('contract/:contractId')
  getContractFees(@Param('contractId') contractId: string) {
    return this.feesService.findByContractId(contractId);
  }

  @Get('analytics/overview')
  getAnalytics() {
    return this.feesService.getAnalytics();
  }

  @Put(':id/status')
  updateStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.feesService.updateStatus(id, status as any);
  }
}
