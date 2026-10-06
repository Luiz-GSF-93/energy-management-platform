import {Body,Controller,Get,Header,Param,ParseUUIDPipe,Post,Query} from '@nestjs/common';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {ReportPolicyService} from './report-policy.service';
import {ReportPolicyStateDto,SaveReportPolicyDto} from './report-policy.dto';
@Controller('report-configuration')
export class ReportPolicyController{
 constructor(private service:ReportPolicyService){}
 @Get() @Header('Cache-Control','private, no-store') @RequirePermission([P.SETTINGS_NOTIFICATIONS_MANAGE]) list(@Tenant() t:TenantContext,@Query('search') search?:string){return this.service.list(t,search);}
 @Post() @Header('Cache-Control','private, no-store') @RequirePermission([P.SETTINGS_NOTIFICATIONS_MANAGE]) save(@Body() d:SaveReportPolicyDto,@Tenant() t:TenantContext){return this.service.save(d,t);}
 @Post(':id/state') @Header('Cache-Control','private, no-store') @RequirePermission([P.SETTINGS_NOTIFICATIONS_MANAGE]) state(@Param('id',ParseUUIDPipe) id:string,@Body() d:ReportPolicyStateDto,@Tenant() t:TenantContext){return this.service.state(id,d,t);}
}
