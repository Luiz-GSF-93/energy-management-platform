import { Controller, Get, Post, Body, Param, Put, Delete, UseGuards, Query } from '@nestjs/common';
import { ContractsService } from '../services/contracts.service';
import { CreateContractDto, UpdateContractDto } from '../dto/create-contract.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('contracts')
@UseGuards(JwtAuthGuard)
export class ContractsController {
  constructor(private contractsService: ContractsService) {}

  @Post()
  create(@Body() createContractDto: CreateContractDto) {
    return this.contractsService.create(createContractDto);
  }

  @Get()
  findByConsumerUnit(@Query('consumerUnitId') consumerUnitId: string) {
    return this.contractsService.findByConsumerUnit(consumerUnitId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.contractsService.findOne(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() updateContractDto: UpdateContractDto) {
    return this.contractsService.update(id, updateContractDto);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.contractsService.delete(id);
  }
}
