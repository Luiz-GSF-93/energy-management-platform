import {
  Controller,
  Get,
  Query,
  Post,
  Body,
  Param,
  Put,
  Delete,
} from '@nestjs/common';
import { CustomersService } from '../services/customers.service';
import { CreateCustomerDto, UpdateCustomerDto } from '../dto/create-customer.dto';
import { OrganizationId, UserId } from '../../../common/decorators/tenant.decorator';
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

  @Get('cnpj/:cnpj')
  @RequirePermission([PERMISSIONS.ORGANIZATION_CUSTOMERS_CREATE])
  async lookupCnpj(@Param('cnpj') cnpj:string) {return this.customersService.lookupCnpj(cnpj);}

  @Get('search')
  @RequirePermission([PERMISSIONS.ORGANIZATION_CUSTOMERS_VIEW])
  search(@OrganizationId() organizationId:string,@Query() query:Record<string,unknown>){return this.customersService.search(organizationId,query);}

  @Get(':id')
  @RequirePermission([PERMISSIONS.ORGANIZATION_CUSTOMERS_VIEW])
  async findOne(
    @Param('id') id: string,
    @OrganizationId() organizationId: string,
  ) {
    return this.customersService.findOne(id, organizationId);
  }

  @Get(':id/edits')
  @RequirePermission([PERMISSIONS.ORGANIZATION_CUSTOMERS_VIEW])
  history(@Param('id') id:string,@OrganizationId() org:string){return this.customersService.history(id,org);}
  @Get(':id/exclusive-users')
  @RequirePermission([PERMISSIONS.ORGANIZATION_CUSTOMERS_UPDATE])
  exclusiveUsers(@Param('id') id:string,@OrganizationId() org:string){return this.customersService.exclusiveUsers(id,org);}
  @Put(':id')
  @RequirePermission([PERMISSIONS.ORGANIZATION_CUSTOMERS_UPDATE])
  async update(
    @Param('id') id: string,
    @Body() updateCustomerDto: any,
    @OrganizationId() organizationId: string,
    @UserId() actor: string,
  ) {
    return this.customersService.update(id, organizationId, updateCustomerDto, actor);
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
