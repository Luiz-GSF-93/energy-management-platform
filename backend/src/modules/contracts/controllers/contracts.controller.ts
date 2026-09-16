import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
} from '@nestjs/common';
import { ContractsService } from '../services/contracts.service';
import { CreateContractDto, UpdateContractDto } from '../dto/create-contract.dto';
import { OrganizationId } from '../../../common/decorators/tenant.decorator';

@Controller('contracts')
export class ContractsController {
  constructor(private contractsService: ContractsService) {}

  @Post()
  async create(
    @Body() createContractDto: CreateContractDto,
    @OrganizationId() organizationId: string,
  ) {
    return this.contractsService.create(createContractDto, organizationId);
  }

  @Get()
  async findAll(@OrganizationId() organizationId: string) {
    return this.contractsService.findAll(organizationId);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @OrganizationId() organizationId: string,
  ) {
    return this.contractsService.findOne(id, organizationId);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() updateContractDto: UpdateContractDto,
    @OrganizationId() organizationId: string,
  ) {
    return this.contractsService.update(id, organizationId, updateContractDto);
  }

  @Delete(':id')
  async delete(
    @Param('id') id: string,
    @OrganizationId() organizationId: string,
  ) {
    return this.contractsService.delete(id, organizationId);
  }
}
