import {Body,Controller,Get,Header,Param,ParseUUIDPipe,Post,Query} from '@nestjs/common';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {InvestmentsService} from './investments.service';
@Controller('contract-investments')
export class InvestmentsController {
 constructor(private service:InvestmentsService){}
 @Get() @Header('Cache-Control','private, no-store') @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW]) list(@Tenant() t:TenantContext,@Query('customerId') c:string,@Query('unitId') u:string){return this.service.workspace(t,c,u);}
 @Post() @Header('Cache-Control','private, no-store') @RequirePermission([P.ORGANIZATION_CONTRACTS_CREATE]) save(@Tenant() t:TenantContext,@Body() d:unknown){return this.service.save(t,d);}
 @Post(':id/validate') @Header('Cache-Control','private, no-store') @RequirePermission([P.ORGANIZATION_CONTRACTS_UPDATE]) validate(@Tenant() t:TenantContext,@Param('id',ParseUUIDPipe) id:string,@Body() d:unknown){return this.service.validate(t,id,d);}
}
