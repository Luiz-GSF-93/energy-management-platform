import {Body,Controller,Get,Post,Query} from '@nestjs/common';
import {Tenant} from '../../../common/decorators/tenant.decorator';
import {TenantContext} from '../../../common/interfaces/tenant-context.interface';
import {RequirePermission} from '../../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../../common/constants/permissions';
import {ContractIndexMemoryService} from '../services/contract-index-memory.service';
@Controller('contract-index-memories')
export class ContractIndexMemoryController{
 constructor(private service:ContractIndexMemoryService){}
 @Get() @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW]) history(@Query() q:any,@Tenant() t:TenantContext){return this.service.history(q,t);}
 @Post('internal-source') @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW,P.DOCUMENTS_VIEW]) source(@Body() b:any,@Tenant() t:TenantContext){return this.service.internalSource(b,t);}
 @Post('preview') @RequirePermission([P.ORGANIZATION_CONTRACTS_UPDATE]) preview(@Body() b:any,@Tenant() t:TenantContext){return this.service.preview(b,t);}
 @Post('authorize') @RequirePermission([P.ORGANIZATION_CONTRACTS_UPDATE]) authorize(@Body() b:any,@Tenant() t:TenantContext){return this.service.action(b,t,'authorize');}
 @Post('cancel') @RequirePermission([P.ORGANIZATION_CONTRACTS_UPDATE]) cancel(@Body() b:any,@Tenant() t:TenantContext){return this.service.action(b,t,'cancel');}
}
