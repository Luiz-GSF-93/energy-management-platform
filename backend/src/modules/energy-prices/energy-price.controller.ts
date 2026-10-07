import {Body,Controller,Get,Header,Post,Query} from '@nestjs/common';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {EnergyPriceService} from './energy-price.service';
@Controller('energy-prices')
export class EnergyPriceController{
 constructor(private readonly service:EnergyPriceService){}
 @Get() @Header('Cache-Control','private, no-store') @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW]) read(@Query() q:unknown,@Tenant() t:TenantContext){return this.service.read(q,t);}
 @Post('publish') @RequirePermission(['26cadaa7-2eea-4080-91f6-1f26f87ca809']) publish(@Body() d:unknown,@Tenant() t:TenantContext){return this.service.publish(d,t);}
}
@Controller('portal/energy-prices')
export class EnergyPricePortalController{
 constructor(private readonly service:EnergyPriceService){}
 @Get() @Header('Cache-Control','private, no-store') @RequirePermission([P.DOCUMENTS_REPORTS_VIEW]) read(@Query() q:unknown,@Tenant() t:TenantContext){return this.service.read(q,t,true);}
}
