import {Body,Controller,Get,Post,Query} from '@nestjs/common';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {EvaTariffWorkbenchService} from './eva-tariff-workbench.service';
@Controller('eva-tariff-workbench')
export class EvaTariffWorkbenchController{
 constructor(private service:EvaTariffWorkbenchService){}
 @Get() @RequirePermission([P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW]) inspect(@Query() q:any,@Tenant() t:TenantContext){return this.service.inspect(q,t);}
 @Post() @RequirePermission([P.ENERGIA_OCR_PROCESS]) command(@Body() b:any,@Tenant() t:TenantContext){return this.service.command(b,t);}
}
