import {Controller,Get,Query} from '@nestjs/common';
import {Tenant} from '../../../common/decorators/tenant.decorator';
import {TenantContext} from '../../../common/interfaces/tenant-context.interface';
import {RequirePermission} from '../../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../../common/constants/permissions';
import {PreparationQueryDto,CustomerPreparationQueryDto} from '../dto/preparation.dto';
import {CalculationPreparationService} from '../services/preparation.service';
@Controller('calculation-preparation')
export class CalculationPreparationController {
 constructor(private service:CalculationPreparationService){}
 @Get('customer') @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW]) inspectCustomer(@Query() d:CustomerPreparationQueryDto,@Tenant() t:TenantContext){return this.service.inspectCustomer(d,t.organizationId);}
 @Get() @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW]) inspect(@Query() d:PreparationQueryDto,@Tenant() t:TenantContext){return this.service.inspect(d,t.organizationId);}
}
