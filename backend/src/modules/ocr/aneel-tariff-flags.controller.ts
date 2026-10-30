import {Controller,Get} from '@nestjs/common';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {AneelTariffFlagsService} from './aneel-tariff-flags.service';
@Controller('tariff-flags')
export class AneelTariffFlagsController{constructor(private service:AneelTariffFlagsService){} @Get() @RequirePermission([P.ORGANIZATION_CONTRACTS_VIEW]) status(@Tenant() t:TenantContext){return this.service.status(t);}}
