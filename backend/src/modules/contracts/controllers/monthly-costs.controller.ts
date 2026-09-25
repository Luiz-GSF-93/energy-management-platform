import {Controller,Get,Post,Put,Body,Param,Query,ParseUUIDPipe} from '@nestjs/common';
import {Tenant} from '../../../common/decorators/tenant.decorator';
import {TenantContext} from '../../../common/interfaces/tenant-context.interface';
import {RequirePermission} from '../../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../../common/constants/permissions';
import {MonthlyCostsService} from '../services/monthly-costs.service';
import {MonthlyCostDto,MonthlyCostQueryDto,UpdateMonthlyCostDto,MonthlyCostRevisionDto} from '../dto/monthly-costs.dto';
@Controller('calculation-monthly-costs')
export class MonthlyCostsController {
 constructor(private service:MonthlyCostsService){}
 @Get() @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW]) list(@Query() q:MonthlyCostQueryDto,@Tenant() t:TenantContext){return this.service.list(q,t);}
 @Get(':id/events') @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW]) events(@Param('id',ParseUUIDPipe) id:string,@Tenant() t:TenantContext){return this.service.events(id,t);}
 @Post() @RequirePermission([P.ORGANIZATION_CONTRACTS_CREATE]) create(@Body() d:MonthlyCostDto,@Tenant() t:TenantContext){return this.service.create(d,t);}
 @Put(':id') @RequirePermission([P.ORGANIZATION_CONTRACTS_UPDATE]) update(@Param('id',ParseUUIDPipe) id:string,@Body() d:UpdateMonthlyCostDto,@Tenant() t:TenantContext){return this.service.update(id,d,t);}
 @Post(':id/validate') @RequirePermission([P.ORGANIZATION_CONTRACTS_UPDATE]) validate(@Param('id',ParseUUIDPipe) id:string,@Body() d:MonthlyCostRevisionDto,@Tenant() t:TenantContext){return this.service.validate(id,d,t);}
}
