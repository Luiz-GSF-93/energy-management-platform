import { Controller, Get, Post, Body, Param, Put, Delete, UseGuards, Request } from '@nestjs/common';
import { CustomersService } from '../services/customers.service';
import { CreateCustomerDto, UpdateCustomerDto } from '../dto/create-customer.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

interface AuthRequest extends Request {
  user: { userId: string; email: string };
}

@Controller('customers')
@UseGuards(JwtAuthGuard)
export class CustomersController {
  constructor(private customersService: CustomersService) {}

  @Post()
  create(@Body() createCustomerDto: CreateCustomerDto) {
    return this.customersService.create(createCustomerDto);
  }

  @Get()
  findAll() {
    // TODO: passar organizationId do JWT
    return this.customersService.findAll('org-default');
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.customersService.findOne(id, 'org-default');
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() updateCustomerDto: UpdateCustomerDto,
  ) {
    return this.customersService.update(id, 'org-default', updateCustomerDto);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.customersService.delete(id, 'org-default');
  }
}
