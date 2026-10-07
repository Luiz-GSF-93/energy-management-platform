import {Body,Controller,Get,Patch,Req,UsePipes,ValidationPipe} from '@nestjs/common';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {IntegrationRenewalService} from './integration-renewal.service';
import {IntegrationRenewalDto} from './integration-renewal.dto';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {DashboardService} from './dashboard.service';
@Controller('admin/dashboard')
@PlatformScope()
export class PlatformDashboardController {
 constructor(private readonly dashboard:DashboardService){}
 @Get() @RequirePermission([P.PLATFORM_ORGANIZATIONS_VIEW])
 get(){return this.dashboard.platform();}
}
@Controller('admin/dashboard/whatsapp-renewal')
@PlatformScope()
@UsePipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true}))
export class IntegrationRenewalController {
 constructor(private readonly renewal:IntegrationRenewalService){}
 @Get() @RequirePermission([P.PLATFORM_ORGANIZATIONS_VIEW]) get(){return this.renewal.get();}
 @Patch() @RequirePermission([P.PLATFORM_ORGANIZATIONS_UPDATE]) save(@Body() dto:IntegrationRenewalDto,@Req() req:RequestWithAuthenticatedUser){return this.renewal.save(dto,req.authenticatedUser.userId);}
}
@Controller('dashboard')
export class OrganizationDashboardController {
 constructor(private readonly dashboard:DashboardService){}
 @Get() @RequirePermission([P.ORGANIZATION_CUSTOMERS_VIEW,P.ORGANIZATION_CONSUMER_UNITS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW,P.ORGANIZATION_USERS_VIEW,P.ORGANIZATION_LICENSES_VIEW,P.DOCUMENTS_VIEW])
 get(@Tenant() tenant:TenantContext){return this.dashboard.organization(tenant);}
}
