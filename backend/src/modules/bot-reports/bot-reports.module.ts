import {EnergyForecastModule} from '../energy-forecast/energy-forecast.module';
import {Body,Controller,Get,Header,Module,Post,Query} from '@nestjs/common';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {CommonModule} from '../../common/common.module';
import {ReportsModule} from '../reports/reports.module';
import {ContractsModule} from '../contracts/contracts.module';
import {OcrModule} from '../ocr/ocr.module';
import {BotReportsService} from './bot-reports.service';
import {ReportAiService} from './report-ai.service';
@Controller('bot-energy/reports')
class BotReportsController {
 constructor(private service:BotReportsService){}
 @Post('backoffice') @Header('Cache-Control','private, no-store') @RequirePermission([P.DOCUMENTS_REPORTS_VIEW,P.INTELLIGENCE_AI_USE]) backoffice(@Body() body:unknown,@Tenant() t:TenantContext){return this.service.ask(body,t,'backoffice');}
 @Post('client') @Header('Cache-Control','private, no-store') @RequirePermission([P.DOCUMENTS_REPORTS_VIEW,P.INTELLIGENCE_AI_USE]) client(@Body() body:unknown,@Tenant() t:TenantContext){return this.service.ask(body,t,'client');}
 @Get('client/units') @Header('Cache-Control','private, no-store') @RequirePermission([P.DOCUMENTS_REPORTS_VIEW,P.INTELLIGENCE_AI_USE]) units(@Query('from') from:string,@Query('to') to:string,@Tenant() t:TenantContext){return this.service.clientUnits(from,to,t);}
}
@Module({imports:[CommonModule,OcrModule,ContractsModule,ReportsModule,EnergyForecastModule],controllers:[BotReportsController],providers:[BotReportsService,ReportAiService]})
export class BotReportsModule {}
