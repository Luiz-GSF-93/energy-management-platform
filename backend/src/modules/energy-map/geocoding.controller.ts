import {Body,Controller,Get,Header,Param,Post,Put} from '@nestjs/common';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {MAP_VIEW,MAP_CUSTOMERS,MAP_MANAGE} from './energy-map.validation';
import {EnergyMapGeocodingService} from './geocoding.service';
@Controller('energy-map/units/:id/geocoding')
export class EnergyMapGeocodingController {
 constructor(private service:EnergyMapGeocodingService){}
 @Get() @Header('Cache-Control','private, no-store') @RequirePermission([MAP_VIEW,MAP_CUSTOMERS]) read(@Param('id') id:string,@Tenant() t:TenantContext){return this.service.read(id,t);}
 @Post() @Header('Cache-Control','private, no-store') @RequirePermission([MAP_VIEW,MAP_CUSTOMERS,MAP_MANAGE]) locate(@Param('id') id:string,@Body() b:unknown,@Tenant() t:TenantContext){return this.service.locate(id,b,t);}
 @Put('confirmation') @Header('Cache-Control','private, no-store') @RequirePermission([MAP_VIEW,MAP_CUSTOMERS,MAP_MANAGE]) confirm(@Param('id') id:string,@Body() b:unknown,@Tenant() t:TenantContext){return this.service.confirm(id,b,t);}
}
