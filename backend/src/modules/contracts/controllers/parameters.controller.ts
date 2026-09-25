import {Controller,Get,Post,Put,Body,Param,ParseUUIDPipe} from '@nestjs/common';
import {Tenant} from '../../../common/decorators/tenant.decorator';
import {TenantContext} from '../../../common/interfaces/tenant-context.interface';
import {RequirePermission} from '../../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../../common/constants/permissions';
import {CalculationParametersService} from '../services/parameters.service';
import {ParameterDto,UpdateParameterDto,ParameterRevisionDto,RetireParameterDto} from '../dto/parameters.dto';
@Controller('calculation-parameters')
export class CalculationParametersController {
 constructor(private service:CalculationParametersService){}
 @Get() @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW]) list(@Tenant() t:TenantContext){return this.service.list(t.organizationId);}
 @Get(':id/events') @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW]) events(@Param('id',ParseUUIDPipe) id:string,@Tenant() t:TenantContext){return this.service.events(id,t.organizationId);}
 @Post() @RequirePermission([P.ORGANIZATION_CONTRACTS_CREATE]) create(@Body() d:ParameterDto,@Tenant() t:TenantContext){return this.service.create(d,t.organizationId,t.userId);}
 @Put(':id') @RequirePermission([P.ORGANIZATION_CONTRACTS_UPDATE]) update(@Param('id',ParseUUIDPipe) id:string,@Body() d:UpdateParameterDto,@Tenant() t:TenantContext){return this.service.update(id,d,t.organizationId,t.userId);}
 @Post(':id/approve') @RequirePermission([P.ORGANIZATION_CONTRACTS_UPDATE]) approve(@Param('id',ParseUUIDPipe) id:string,@Body() d:ParameterRevisionDto,@Tenant() t:TenantContext){return this.service.approve(id,d,t.organizationId,t.userId);}
 @Post(':id/retire') @RequirePermission([P.ORGANIZATION_CONTRACTS_UPDATE]) retire(@Param('id',ParseUUIDPipe) id:string,@Body() d:RetireParameterDto,@Tenant() t:TenantContext){return this.service.retire(id,d,t.organizationId,t.userId);}
}
