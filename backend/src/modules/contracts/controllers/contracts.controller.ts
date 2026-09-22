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
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { PERMISSIONS } from '../../../common/constants/permissions';

@Controller('contracts')
export class ContractsController {
  constructor(private contractsService: ContractsService) {}

  @Post()
  @RequirePermission([PERMISSIONS.ORGANIZATION_CONTRACTS_CREATE])
  async create(
    @Body() createContractDto: CreateContractDto,
    @OrganizationId() organizationId: string,
  ) {
    return this.contractsService.create(createContractDto, organizationId);
  }

  @Get()
  @RequirePermission([PERMISSIONS.ORGANIZATION_CONTRACTS_VIEW])
  async findAll(@OrganizationId() organizationId: string) {
    return this.contractsService.findAll(organizationId);
  }

  @Get(':id')
  @RequirePermission([PERMISSIONS.ORGANIZATION_CONTRACTS_VIEW])
  async findOne(
    @Param('id') id: string,
    @OrganizationId() organizationId: string,
  ) {
    return this.contractsService.findOne(id, organizationId);
  }

  @Put(':id')
  @RequirePermission([PERMISSIONS.ORGANIZATION_CONTRACTS_UPDATE])
  async update(
    @Param('id') id: string,
    @Body() updateContractDto: UpdateContractDto,
    @OrganizationId() organizationId: string,
  ) {
    return this.contractsService.update(id, organizationId, updateContractDto);
  }

  @Delete(':id')
  @RequirePermission([PERMISSIONS.ORGANIZATION_CONTRACTS_DELETE])
  async delete(
    @Param('id') id: string,
    @OrganizationId() organizationId: string,
  ) {
    return this.contractsService.delete(id, organizationId);
  }
}
