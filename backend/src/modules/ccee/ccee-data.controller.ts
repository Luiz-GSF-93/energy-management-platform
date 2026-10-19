import {BadRequestException,Body,Controller,Get,Header,Param,Post,Query,Req} from '@nestjs/common';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {TEAM_MANAGE,PLATFORM_COSTS_VIEW} from '../platform-team/platform-team.permissions';
import {PLAN_VIEW} from '../plans/plans.service';
import {cceeObject,cceeText,cceeUuid} from './ccee-data.model';
import {CceeDataService} from './ccee-data.service';
@Controller('ccee-data')
export class CceeDataController{
 constructor(private data:CceeDataService){}
 @Get() @Header('Cache-Control','private, no-store') read(@Tenant()t:TenantContext,@Query('page')page?:string){return this.data.workspace(t,page===undefined?0:Number(page));}
 @Post('bindings') binding(@Tenant()t:TenantContext,@Body()b:unknown){return this.data.binding(t,b);}
 @Post('bindings/:id/:decision') review(@Tenant()t:TenantContext,@Param('id')id:string,@Param('decision')decision:string,@Body()b:unknown){return this.data.reviewBinding(t,id,decision,b);}
 @Post('jobs') enqueue(@Tenant()t:TenantContext,@Body()b:unknown){return this.data.enqueue(t,b);}
 @Get('history') @Header('Cache-Control','private, no-store') history(@Tenant()t:TenantContext,@Query('jobId')id?:string,@Query('page')page?:string){return this.data.history(t,id,page===undefined?0:Number(page));}
 @Get('jobs/:id') @Header('Cache-Control','private, no-store') job(@Tenant()t:TenantContext,@Param('id')id:string){return this.data.job(t,id);}
 @Get('jobs/:id/invoices') @Header('Cache-Control','private, no-store') invoices(@Tenant()t:TenantContext,@Param('id')id:string){return this.data.invoiceCandidates(t,id);}
 @Post('jobs/:id/reconciliations') reconcile(@Tenant()t:TenantContext,@Param('id')id:string,@Body()b:unknown){return this.data.reconcileInvoice(t,id,b);}
 @Get('reconciliations') @Header('Cache-Control','private, no-store') reconciliations(@Tenant()t:TenantContext,@Query('unitId')unit:string,@Query('month')month:string,@Query('page')page?:string){return this.data.reconciliations(t,unit,month,page===undefined?0:Number(page));}
 @Get('jobs/:id/measurements.csv') @Header('Cache-Control','private, no-store') @Header('Content-Type','text/csv; charset=utf-8') @Header('Content-Disposition','attachment; filename="EnergyOS-CCEE-medicoes.csv"') exportMeasurements(@Tenant()t:TenantContext,@Param('id')id:string){return this.data.exportMeasurements(t,id);}
 @Post('jobs/:id/cancel') cancel(@Tenant()t:TenantContext,@Param('id')id:string,@Body()b:unknown){return this.data.cancel(t,id,b);}
 @Get('jobs/:id/preparation') @Header('Cache-Control','private, no-store') preparation(@Tenant()t:TenantContext,@Param('id')id:string){return this.data.preparation(t,id);}
 @Post('jobs/:id/preparation') apply(@Tenant()t:TenantContext,@Param('id')id:string,@Body()b:unknown){return this.data.applyPreparation(t,id,b);}
 @Get('calendar') @Header('Cache-Control','private, no-store') calendar(@Tenant()t:TenantContext,@Query('versionId')v?:string,@Query('page')page?:string){return this.data.calendar(t,v,page===undefined?0:Number(page));}
 @Post('calendar/assign') assign(@Tenant()t:TenantContext,@Body()b:unknown){return this.data.applyCalendar(t,b);}
}
@Controller('admin/integrations/ccee-data/calendar') @PlatformScope()
export class CceeCalendarController{
 constructor(private data:CceeDataService){}
 @Get() @Header('Cache-Control','private, no-store') @RequirePermission([TEAM_MANAGE]) read(@Req()r:RequestWithAuthenticatedUser,@Query('page')page?:string,@Query('versionId')v?:string){return this.data.ownerCalendar(r.authenticatedUser.userId,'list',v?cceeUuid(v):null,{page:page===undefined?0:Number(page)});}
 @Post() @RequirePermission([TEAM_MANAGE]) collect(@Req()r:RequestWithAuthenticatedUser,@Body()b:unknown){return this.data.collectCalendar(r.authenticatedUser.userId,b);}
 @Post(':id/:decision') @RequirePermission([TEAM_MANAGE]) review(@Req()r:RequestWithAuthenticatedUser,@Param('id')id:string,@Param('decision')decision:string,@Body()body:unknown){
  const b=cceeObject(body,['requestId','reason']);cceeUuid(b.requestId);cceeText(b.reason,1000);
  if(!['approve','reject'].includes(decision))throw new BadRequestException('Decisão inválida.');return this.data.ownerCalendar(r.authenticatedUser.userId,decision,cceeUuid(id),b);
 }
}
@Controller('admin/platform-costs/ccee') @PlatformScope()
export class CceeDataMetricsController{
 constructor(private data:CceeDataService){}
 @Get() @Header('Cache-Control','private, no-store') @RequirePermission([PLAN_VIEW,PLATFORM_COSTS_VIEW]) read(@Req()r:RequestWithAuthenticatedUser,@Query('month')m?:string){return this.data.metrics(r.authenticatedUser.userId,m??new Date().toISOString().slice(0,7));}
}
