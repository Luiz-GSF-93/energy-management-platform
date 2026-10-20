import {Body,Controller,Get,Header,Param,Post,Query} from '@nestjs/common';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {CceeDriService} from './ccee-dri.service';
@Controller('ccee-data/dri')
export class CceeDriController{
 constructor(private dri:CceeDriService){}
 @Get() @Header('Cache-Control','private, no-store') list(@Tenant()t:TenantContext,@Query('authorizationId')id:string,@Query('month')month:string){return this.dri.list(t,id,month);}
 @Post('jobs') enqueue(@Tenant()t:TenantContext,@Body()body:unknown){return this.dri.enqueue(t,body);}
 @Get('jobs/:id') @Header('Cache-Control','private, no-store') job(@Tenant()t:TenantContext,@Param('id')id:string){return this.dri.job(t,id);}
}
