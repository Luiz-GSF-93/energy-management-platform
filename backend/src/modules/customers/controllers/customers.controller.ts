import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
} from '@nestjs/common';
import { CustomersService } from '../services/customers.service';
import { CreateCustomerDto, UpdateCustomerDto } from '../dto/create-customer.dto';
import { OrganizationId } from '../../../common/decorators/tenant.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { PERMISSIONS } from '../../../common/constants/permissions';

@Controller('customers')
export class CustomersController {
  constructor(private customersService: CustomersService) {}

  @Post()
  @RequirePermission([PERMISSIONS.ORGANIZATION_CUSTOMERS_CREATE])
  async create(
    @Body() createCustomerDto: CreateCustomerDto,
    @OrganizationId() organizationId: string,
  ) {
    return this.customersService.create(createCustomerDto, organizationId);
  }

  @Get()
  @RequirePermission([PERMISSIONS.ORGANIZATION_CUSTOMERS_VIEW])
  async findAll(@OrganizationId() organizationId: string) {
    return this.customersService.findAll(organizationId);
  }

  @Get(':id')
  @RequirePermission([PERMISSIONS.ORGANIZATION_CUSTOMERS_VIEW])
  async findOne(
    @Param('id') id: string,
    @OrganizationId() organizationId: string,
  ) {
    return this.customersService.findOne(id, organizationId);
  }

  @Put(':id')
  @RequirePermission([PERMISSIONS.ORGANIZATION_CUSTOMERS_UPDATE])
  async update(
    @Param('id') id: string,
    @Body() updateCustomerDto: UpdateCustomerDto,
    @OrganizationId() organizationId: string,
  ) {
    return this.customersService.update(id, organizationId, updateCustomerDto);
  }

  @Delete(':id')
  @RequirePermission([PERMISSIONS.ORGANIZATION_CUSTOMERS_DELETE])
  async delete(
    @Param('id') id: string,
    @OrganizationId() organizationId: string,
  ) {
    return this.customersService.delete(id, organizationId);
  }
}
