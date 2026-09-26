import {Controller,Get,Post,Body,Query} from '@nestjs/common';
import {Tenant} from '../../../common/decorators/tenant.decorator';
import {TenantContext} from '../../../common/interfaces/tenant-context.interface';
import {RequirePermission} from '../../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../../common/constants/permissions';
import {SupplierBillingService} from '../services/supplier-billing.service';
import {SupplierBillingDto,SupplierBillingQueryDto,SupplierCycleQueryDto} from '../dto/supplier-billing.dto';
@Controller('supplier-billing-rules')
export class SupplierBillingController {constructor(private service:SupplierBillingService){}
 @Get('cycle') @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW]) cycle(@Query() d:SupplierCycleQueryDto,@Tenant() t:TenantContext){return this.service.cycle(d,t);}
 @Get() @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW]) list(@Query() d:SupplierBillingQueryDto,@Tenant() t:TenantContext){return this.service.list(d,t);}
 @Post() @RequirePermission([P.ORGANIZATION_CONTRACTS_UPDATE]) create(@Body() d:SupplierBillingDto,@Tenant() t:TenantContext){return this.service.create(d,t);}
}
