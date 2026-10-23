import {Body,Controller,Get,Header,Param,Post,Query} from '@nestjs/common';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {CceeMarketService} from './ccee-market.service';
@Controller('ccee-market')
export class CceeMarketController{
 constructor(private service:CceeMarketService){}
 @Get() @Header('Cache-Control','private, no-store') read(@Tenant()t:TenantContext,@Query()q:Record<string,unknown>){return this.service.read(t,q);}
 @Get('measurements') @Header('Cache-Control','private, no-store') measurements(@Tenant()t:TenantContext,@Query()q:Record<string,unknown>){return this.service.measurements(t,q);}
 @Post('schedules') configure(@Tenant()t:TenantContext,@Body()b:unknown){return this.service.schedule(t,null,b);}
 @Post('schedules/:id') command(@Tenant()t:TenantContext,@Param('id')id:string,@Body()b:unknown){return this.service.schedule(t,id,b);}
}
