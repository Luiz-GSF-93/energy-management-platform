import {Controller,Get,Put,Header,Query,Param,Body} from '@nestjs/common';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {EnergyMapService} from './energy-map.service';
import {MAP_VIEW,MAP_CUSTOMERS,MAP_MANAGE} from './energy-map.validation';

@Controller('energy-map')
export class EnergyMapController {
 constructor(private service:EnergyMapService){}
 @Get('access') @Header('Cache-Control','private, no-store') @RequirePermission([MAP_VIEW,MAP_CUSTOMERS]) access(@Tenant() t:TenantContext){return this.service.access(t);}
 @Get('units') @Header('Cache-Control','private, no-store') @RequirePermission([MAP_VIEW,MAP_CUSTOMERS]) units(@Query() q:Record<string,unknown>,@Tenant() t:TenantContext){return this.service.units(q,t);}
 @Get('units/:id/history') @Header('Cache-Control','private, no-store') @RequirePermission([MAP_VIEW,MAP_CUSTOMERS]) history(@Param('id') id:string,@Tenant() t:TenantContext){return this.service.history(id,t);}
 @Put('units/:id/location') @Header('Cache-Control','private, no-store') @RequirePermission([MAP_MANAGE,MAP_VIEW,MAP_CUSTOMERS]) save(@Param('id') id:string,@Body() b:unknown,@Tenant() t:TenantContext){return this.service.save(id,b,t);}
}
