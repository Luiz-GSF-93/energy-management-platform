import {Controller,Get,Post,Body,Query} from '@nestjs/common';
import {Tenant} from '../../../common/decorators/tenant.decorator';
import {TenantContext} from '../../../common/interfaces/tenant-context.interface';
import {RequirePermission} from '../../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../../common/constants/permissions';
import {SpotReconciliationService} from '../services/spot-reconciliation.service';
import {SpotReconciliationDto,SpotReconciliationQueryDto} from '../dto/spot-reconciliation.dto';
@Controller('supplier-spot-reconciliations')
export class SpotReconciliationController {constructor(private service:SpotReconciliationService){}
 @Get() @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW,P.DOCUMENTS_VIEW]) list(@Query() d:SpotReconciliationQueryDto,@Tenant() t:TenantContext){return this.service.list(d,t);}
 @Post() @RequirePermission([P.ORGANIZATION_CONTRACTS_UPDATE,P.DOCUMENTS_VIEW]) create(@Body() d:SpotReconciliationDto,@Tenant() t:TenantContext){return this.service.create(d,t);}
}
