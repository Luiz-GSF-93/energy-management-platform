import {Body,Controller,Get,Param,Post} from '@nestjs/common';
import {Tenant} from '../../../common/decorators/tenant.decorator';
import {TenantContext} from '../../../common/interfaces/tenant-context.interface';
import {RequirePermission} from '../../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../../common/constants/permissions';
import {FeeAdjustmentsService} from '../services/fee-adjustments.service';
@Controller('fee-adjustments')
export class FeeAdjustmentsController {
 constructor(private service:FeeAdjustmentsService){}
 @Get('notices') notices(@Tenant() t:TenantContext){return this.service.notices(t);}
 @Get(':kind/:id') @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW]) list(@Param('kind') k:string,@Param('id') id:string,@Tenant() t:TenantContext){return this.service.list(k,id,t);}
 @Post(':kind/:id') @RequirePermission([P.ORGANIZATION_CONTRACTS_UPDATE]) create(@Param('kind') k:string,@Param('id') id:string,@Body() d:any,@Tenant() t:TenantContext){return this.service.create(k,id,d,t);}
}
