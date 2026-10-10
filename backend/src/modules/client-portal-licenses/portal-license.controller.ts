import {Body,Controller,Get,Post,UsePipes,ValidationPipe} from '@nestjs/common';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {PortalLicenseService} from './portal-license.service';
import {PortalLicenseDto,PortalPolicyDto,ClientAdditionDto} from './portal-license.dto';
@Controller('licenses/portal') @UsePipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true}))
export class PortalLicenseController {
 constructor(private licenses:PortalLicenseService){}
 @Get() @RequirePermission([P.ORGANIZATION_LICENSES_VIEW]) list(@Tenant() t:TenantContext){return this.licenses.list(t);}
 @Post() @RequirePermission([P.ORGANIZATION_USERS_INVITE]) save(@Tenant() t:TenantContext,@Body() dto:PortalLicenseDto){return this.licenses.save(t,dto);}
 @Post('policy') @RequirePermission([P.ORGANIZATION_LICENSES_UPDATE]) policy(@Tenant() t:TenantContext,@Body() dto:PortalPolicyDto){return this.licenses.policy(t,dto);}
 @Post('additions') @RequirePermission([P.ORGANIZATION_LICENSES_UPDATE]) addition(@Tenant() t:TenantContext,@Body() dto:ClientAdditionDto){return this.licenses.addition(t,dto);}
}
@Controller('portal')
export class ClientPortalLicenseController {
 constructor(private licenses:PortalLicenseService){}
 @Get('license') @RequirePermission([P.DOCUMENTS_REPORTS_VIEW]) state(@Tenant() t:TenantContext){return this.licenses.client(t);}
}
