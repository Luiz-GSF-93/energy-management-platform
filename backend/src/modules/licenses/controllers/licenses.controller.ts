import { Controller, Get } from '@nestjs/common';
import { PERMISSIONS } from '../../../common/constants/permissions';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { Tenant } from '../../../common/decorators/tenant.decorator';
import { TenantContext } from '../../../common/interfaces/tenant-context.interface';
import { LicensesService } from '../services/licenses.service';

@Controller('licenses')
export class LicensesController {
  constructor(private readonly licensesService: LicensesService) {}

  @Get('effective')
  @RequirePermission([PERMISSIONS.ORGANIZATION_LICENSES_VIEW])
  async findEffective(@Tenant() tenant: TenantContext) {
    return this.licensesService.resolveEffectiveLicense(tenant.organizationId);
  }
}
