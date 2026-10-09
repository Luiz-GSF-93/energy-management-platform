import {Body,Controller,Get,Header,Param,ParseUUIDPipe,Post,Query,Res} from '@nestjs/common';
import {Response} from 'express';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {CreateReportDto} from './report.dto';
import {ReportsService} from './reports.service';
import {reportPdf,reportExcel} from './report.render';
@Controller('reports')
export class ReportsController {
 constructor(private service:ReportsService){}
 @Get('selection') @Header('Cache-Control','private, no-store') @RequirePermission([P.DOCUMENTS_REPORTS_VIEW]) selection(@Tenant() t:TenantContext){return this.service.selection(t);}
 @Get() @Header('Cache-Control','private, no-store') @RequirePermission([P.DOCUMENTS_REPORTS_VIEW]) list(@Tenant() t:TenantContext,@Query() q:Record<string,string>){return this.service.list(t,q);}
 @Post() @Header('Cache-Control','private, no-store') @RequirePermission([P.DOCUMENTS_REPORTS_CREATE]) create(@Body() d:CreateReportDto,@Tenant() t:TenantContext){return this.service.create(d,t);}
 @Get(':id') @Header('Cache-Control','private, no-store') @RequirePermission([P.DOCUMENTS_REPORTS_VIEW]) one(@Param('id',ParseUUIDPipe) id:string,@Tenant() t:TenantContext){return this.service.one(id,t);}
 @Get(':id/pdf') @RequirePermission([P.DOCUMENTS_REPORTS_VIEW]) async pdf(@Param('id',ParseUUIDPipe) id:string,@Tenant() t:TenantContext,@Res() res:Response){const r=await this.service.one(id,t);res.set({'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="EnergyOS-${id}.pdf"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.send(await reportPdf(r));}
 @Get(':id/excel') @RequirePermission([P.DOCUMENTS_REPORTS_VIEW]) async excel(@Param('id',ParseUUIDPipe) id:string,@Tenant() t:TenantContext,@Res() res:Response){const r=await this.service.one(id,t);res.set({'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="EnergyOS-${id}.xlsx"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.send(await reportExcel(r));}
}
