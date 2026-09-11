import { Controller, Get, Post, Body, Param, Put } from '@nestjs/common';
import { ManagementFeesService } from '../services/management-fees.service';
import { CreateFeeDto, UpdateFeeDto } from '../dtos/create-fee.dto';

@Controller('api/v1/fees')
export class ManagementFeesController {
  constructor(private readonly feesService: ManagementFeesService) {}

  @Post()
  async create(@Body() createFeeDto: CreateFeeDto) {
    return this.feesService.createFee(createFeeDto);
  }

  @Get()
  async findAll() {
    return this.feesService.findAllFees();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.feesService.findFeeById(id);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() updateFeeDto: UpdateFeeDto) {
    return this.feesService.updateFeeStatus(id, updateFeeDto);
  }

  @Get('contract/:contractId')
  async getFeesByContract(@Param('contractId') contractId: string) {
    return this.feesService.findFeesByContract(contractId);
  }

  @Get('status/:status')
  async getFeesByStatus(@Param('status') status: string) {
    const validStatus = status as 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID';
    return this.feesService.findFeesByStatus(validStatus);
  }

  @Get('analytics/overview')
  async getAnalytics() {
    return this.feesService.getFeesAnalytics();
  }
}
