import { Controller, Get, Post, Body, Param, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ManagementFeesService } from '../services/management-fees.service';
import { CreateFeeDto } from '../dtos/create-fee.dto';

@Controller('api/v1/fees')
@UseGuards(JwtAuthGuard)
export class ManagementFeesController {
  constructor(private readonly feesService: ManagementFeesService) {}

  @Post()
  createFee(@Body() createFeeDto: CreateFeeDto) {
    return this.feesService.createFee(createFeeDto);
  }

  @Get()
  async findAllFees(@Query('status') status?: string) {
    if (status && ['PENDING', 'APPROVED', 'REJECTED', 'PAID'].includes(status)) {
      return this.feesService.findFeesByStatus(status as any);
    }
    return this.feesService.findAllFees();
  }

  @Get(':id')
  findFeeById(@Param('id') id: string) {
    return this.feesService.findFeeById(id);
  }

  @Get('contract/:contractId')
  getFeesByContract(@Param('contractId') contractId: string) {
    return this.feesService.findFeesByContract(contractId);
  }

  @Get('analytics/overview')
  getFeesAnalytics() {
    return this.feesService.getFeesAnalytics();
  }

  @Put(':id/status')
  updateFeeStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.feesService.updateFeeStatus(id, { status } as any);
  }
}
