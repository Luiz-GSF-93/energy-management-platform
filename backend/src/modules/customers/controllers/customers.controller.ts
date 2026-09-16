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

@Controller('customers')
export class CustomersController {
  constructor(private customersService: CustomersService) {}

  @Post()
  async create(
    @Body() createCustomerDto: CreateCustomerDto,
    @OrganizationId() organizationId: string,
  ) {
    return this.customersService.create(createCustomerDto, organizationId);
  }

  @Get()
  async findAll(@OrganizationId() organizationId: string) {
    return this.customersService.findAll(organizationId);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @OrganizationId() organizationId: string,
  ) {
    return this.customersService.findOne(id, organizationId);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() updateCustomerDto: UpdateCustomerDto,
    @OrganizationId() organizationId: string,
  ) {
    return this.customersService.update(id, organizationId, updateCustomerDto);
  }

  @Delete(':id')
  async delete(
    @Param('id') id: string,
    @OrganizationId() organizationId: string,
  ) {
    return this.customersService.delete(id, organizationId);
  }
}
