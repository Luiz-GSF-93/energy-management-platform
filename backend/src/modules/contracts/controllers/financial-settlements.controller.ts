import {Body,Controller,Get,Header,Param,ParseUUIDPipe,Post,Query} from '@nestjs/common';
import {Tenant} from '../../../common/decorators/tenant.decorator';
import {TenantContext} from '../../../common/interfaces/tenant-context.interface';
import {RequirePermission} from '../../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../../common/constants/permissions';
import {PreparationQueryDto} from '../dto/preparation.dto';
import {PrepareFinancialSettlementDto,FinancialSettlementTransitionDto,PublishedFinancialQueryDto,FinancialAnalyticsQueryDto} from '../dto/financial-settlements.dto';
import {FinancialSettlementsService} from '../services/financial-settlements.service';
@Controller('financial-settlements')
export class FinancialSettlementsController {
 constructor(private service:FinancialSettlementsService){}
 @Get() @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW]) list(@Query() q:PreparationQueryDto,@Tenant() t:TenantContext){return this.service.list(q,t);}
 @Get('published') @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW]) published(@Query() q:PublishedFinancialQueryDto,@Tenant() t:TenantContext){return this.service.published(q,t);}
 @Get('reports') @Header('Cache-Control','private, no-store') @RequirePermission([P.DOCUMENTS_REPORTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW]) reports(@Query() q:FinancialAnalyticsQueryDto,@Tenant() t:TenantContext){return this.service.reports(q,t);}
 @Get(':id') @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW]) one(@Param('id',ParseUUIDPipe) id:string,@Tenant() t:TenantContext){return this.service.one(id,t);}
 @Post() @RequirePermission([P.ORGANIZATION_CONTRACTS_CREATE]) prepare(@Body() d:PrepareFinancialSettlementDto,@Tenant() t:TenantContext){return this.service.prepare(d,t);}
 @Post(':id/approve') @RequirePermission([P.ORGANIZATION_CONTRACTS_UPDATE]) approve(@Param('id',ParseUUIDPipe) id:string,@Body() d:FinancialSettlementTransitionDto,@Tenant() t:TenantContext){return this.service.transition(id,d,'APPROVE',t);}
 @Post(':id/publish') @RequirePermission([P.ORGANIZATION_CONTRACTS_UPDATE]) publish(@Param('id',ParseUUIDPipe) id:string,@Body() d:FinancialSettlementTransitionDto,@Tenant() t:TenantContext){return this.service.transition(id,d,'PUBLISH',t);}
}
