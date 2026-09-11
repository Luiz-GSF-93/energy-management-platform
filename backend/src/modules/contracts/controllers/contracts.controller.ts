import { Controller, Get, Post, Body, Param, Put, Delete, UseGuards, Query } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ContractsService } from '../services/contracts.service';
import { CreateContractDto } from '../dto/create-contract.dto';

@Controller('api/v1/contracts')
@UseGuards(JwtAuthGuard)
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Post()
  create(@Body() createContractDto: CreateContractDto) {
    return this.contractsService.create(createContractDto);
  }

  @Get()
  findAll(@Query('status') status?: string) {
    if (status) {
      return this.contractsService.findByStatus(status as any);
    }
    return this.contractsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.contractsService.findOne(id);
  }

  @Get(':id/fees')
  getContractFees(@Param('id') id: string) {
    return this.contractsService.getContractFees(id);
  }

  @Get('analytics/overview')
  getAnalytics() {
    return this.contractsService.getAnalytics();
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() updateContractDto: any) {
    return this.contractsService.update(id, updateContractDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.contractsService.remove(id);
  }
}
