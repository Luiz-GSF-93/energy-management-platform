import {Controller,Get,Header,Query} from '@nestjs/common';
import {Tenant} from '../../../common/decorators/tenant.decorator';
import {TenantContext} from '../../../common/interfaces/tenant-context.interface';
import {RequirePermission} from '../../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../../common/constants/permissions';
import {PortalFinancialQueryDto,PublishedFinancialQueryDto} from '../dto/financial-settlements.dto';
import {FinancialSettlementsService} from '../services/financial-settlements.service';
@Controller('portal')
export class ClientPortalController {
 constructor(private service:FinancialSettlementsService){}
 @Get('access') @Header('Cache-Control','private, no-store') access(@Tenant() t:TenantContext){return this.service.portalAccess(t);}
 @Get('financial') @Header('Cache-Control','private, no-store') @RequirePermission([P.DOCUMENTS_REPORTS_VIEW]) financial(@Query() q:PortalFinancialQueryDto,@Tenant() t:TenantContext){return this.service.portalFinancial(q,t);}
 @Get('preview') @Header('Cache-Control','private, no-store') @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW]) preview(@Query() q:PublishedFinancialQueryDto,@Tenant() t:TenantContext){return this.service.portalPreview(q,t);}
}
