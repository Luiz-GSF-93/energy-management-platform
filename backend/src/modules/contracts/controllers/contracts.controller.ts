import { Controller, Get, Post, Body, Param, Put, Delete, UseGuards } from '@nestjs/common';
import { ContractsService } from '../services/contracts.service';
import { CreateContractDto, UpdateContractDto } from '../dto/create-contract.dto';

@Controller('api/v1/contracts')
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Post()
  async create(@Body() createContractDto: CreateContractDto) {
    return this.contractsService.create(createContractDto);
  }

  @Get()
  async findAll() {
    return this.contractsService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.contractsService.findOne(id);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() updateContractDto: UpdateContractDto,
  ) {
    return this.contractsService.update(id, updateContractDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.contractsService.remove(id);
  }

  @Get(':id/fees')
  async getContractFees(@Param('id') id: string) {
    return this.contractsService.getContractFees(id);
  }

  @Get('status/:status')
  async findByStatus(@Param('status') status: string) {
    return this.contractsService.findByStatus(status);
  }
}
