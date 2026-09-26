import {Controller,Get,Post,Body,Query} from '@nestjs/common';
import {Tenant} from '../../../common/decorators/tenant.decorator';
import {TenantContext} from '../../../common/interfaces/tenant-context.interface';
import {RequirePermission} from '../../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../../common/constants/permissions';
import {ManagementAllocationService} from '../services/management-allocation.service';
import {ManagementAllocationDto,ManagementAllocationQueryDto} from '../dto/management-allocation.dto';
@Controller('management-fee-allocations')
export class ManagementAllocationController {
 constructor(private service:ManagementAllocationService){}
 @Get() @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW]) list(@Query() d:ManagementAllocationQueryDto,@Tenant() t:TenantContext){return this.service.list(d,t);}
 @Post() @RequirePermission([P.ORGANIZATION_CONTRACTS_UPDATE]) create(@Body() d:ManagementAllocationDto,@Tenant() t:TenantContext){return this.service.create(d,t);}
}
