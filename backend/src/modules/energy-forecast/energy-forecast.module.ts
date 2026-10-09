import {Body,Controller,Get,Header,Module,Param,ParseUUIDPipe,Post,Query} from '@nestjs/common';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {SupabaseService} from '../../services/supabase.service';
import {LicensesModule} from '../licenses/licenses.module';
import {EnergyForecastService} from './energy-forecast.service';
import {PublishedClientForecastService} from './published-client-forecast.service';
import {PublishedClientForecastController} from './published-client-forecast.controller';
import {OcrModule} from '../ocr/ocr.module';
@Controller('energy-forecasts')
class EnergyForecastController {
 constructor(private service:EnergyForecastService){}
 @Get('workspace') @Header('Cache-Control','private, no-store') @RequirePermission([P.DOCUMENTS_REPORTS_VIEW]) workspace(@Tenant() t:TenantContext,@Query('customerId') c:string,@Query('unitId') u:string){return this.service.workspace(t,c,u);}
 @Get('access') @Header('Cache-Control','private, no-store') @RequirePermission([P.DOCUMENTS_REPORTS_VIEW]) access(@Tenant() t:TenantContext){return this.service.access(t,false,true);}
 @Get('documents') @Header('Cache-Control','private, no-store') @RequirePermission([P.DOCUMENTS_REPORTS_VIEW]) documents(@Tenant() t:TenantContext){return this.service.documents(t);}
 @Get('documents/:id/draft') @Header('Cache-Control','private, no-store') @RequirePermission([P.DOCUMENTS_REPORTS_VIEW]) draft(@Param('id',ParseUUIDPipe) id:string,@Tenant() t:TenantContext){return this.service.draft(id,t);}
 @Get('histories') @Header('Cache-Control','private, no-store') @RequirePermission([P.DOCUMENTS_REPORTS_VIEW]) histories(@Tenant() t:TenantContext){return this.service.histories(t);}
 @Post('histories') @Header('Cache-Control','private, no-store') @RequirePermission([P.DOCUMENTS_REPORTS_CREATE]) record(@Body() d:unknown,@Tenant() t:TenantContext){return this.service.recordHistory(d,t);}
 @Post('histories/:id/validate') @Header('Cache-Control','private, no-store') @RequirePermission([P.DOCUMENTS_REPORTS_CREATE]) approve(@Param('id',ParseUUIDPipe) id:string,@Body() d:unknown,@Tenant() t:TenantContext){return this.service.approveHistory(id,d,t);}
 @Get('sources') @Header('Cache-Control','private, no-store') @RequirePermission([P.DOCUMENTS_REPORTS_VIEW]) sources(@Tenant() t:TenantContext){return this.service.sources(t);}
 @Get() @Header('Cache-Control','private, no-store') @RequirePermission([P.DOCUMENTS_REPORTS_VIEW]) list(@Tenant() t:TenantContext){return this.service.list(t);}
 @Get(':id') @Header('Cache-Control','private, no-store') @RequirePermission([P.DOCUMENTS_REPORTS_VIEW]) one(@Param('id',ParseUUIDPipe) id:string,@Tenant() t:TenantContext){return this.service.one(id,t);}
 @Post() @Header('Cache-Control','private, no-store') @RequirePermission([P.DOCUMENTS_REPORTS_CREATE]) prepare(@Body() d:unknown,@Tenant() t:TenantContext){return this.service.prepare(d,t);}
 @Post(':id/transitions') @Header('Cache-Control','private, no-store') @RequirePermission([P.DOCUMENTS_REPORTS_CREATE]) transition(@Param('id',ParseUUIDPipe) id:string,@Body() d:unknown,@Tenant() t:TenantContext){return this.service.transition(id,d,t);}
}
@Module({imports:[LicensesModule,OcrModule],controllers:[EnergyForecastController,PublishedClientForecastController],providers:[EnergyForecastService,PublishedClientForecastService,SupabaseService],exports:[EnergyForecastService,PublishedClientForecastService]})
export class EnergyForecastModule {}
