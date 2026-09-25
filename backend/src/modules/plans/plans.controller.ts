import {ForbiddenException,Body,Controller,Get,Param,ParseUUIDPipe,Patch,Post,Req,UsePipes,ValidationPipe} from '@nestjs/common';
import {Request} from 'express';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {PlansService,PLAN_VIEW,PLAN_MANAGE} from './plans.service';
import {ApplyPlanDto,SavePlanDto,UpgradeRequestDto} from './plans.dto';
const validation=new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true});
@Controller('admin/plans') @PlatformScope() @UsePipes(validation)
export class PlatformPlansController {
 constructor(private readonly plans:PlansService){}
 @Get('upgrade-requests') @RequirePermission([PLAN_VIEW]) upgrades(){return this.plans.upgrades();}
 @Post('upgrade-requests/:id/resolve') @RequirePermission([PLAN_MANAGE]) resolve(@Param('id',new ParseUUIDPipe()) id:string,@Req() req:RequestWithAuthenticatedUser){return this.plans.resolveUpgrade(id,req.authenticatedUser.userId);}
 @Get() @RequirePermission([PLAN_VIEW]) list(){return this.plans.list();}
 @Post() @RequirePermission([PLAN_MANAGE]) create(@Body() dto:SavePlanDto,@Req() req:RequestWithAuthenticatedUser){return this.plans.save(null,dto,{userId:req.authenticatedUser.userId,ip:req.ip,agent:req.get('user-agent')});}
 @Patch(':id') @RequirePermission([PLAN_MANAGE]) update(@Param('id',new ParseUUIDPipe()) id:string,@Body() dto:SavePlanDto,@Req() req:RequestWithAuthenticatedUser){return this.plans.save(id,dto,{userId:req.authenticatedUser.userId,ip:req.ip,agent:req.get('user-agent')});}
}
@Controller('licenses') @UsePipes(validation)
export class OrganizationPlansController {
 constructor(private readonly plans:PlansService){}
 @Get('usage') @RequirePermission([P.ORGANIZATION_LICENSES_VIEW]) usage(@Tenant() tenant:TenantContext){return this.plans.usage(tenant.organizationId);}
 @Post('upgrade-requests') @RequirePermission([P.ORGANIZATION_LICENSES_VIEW]) request(@Body() dto:UpgradeRequestDto,@Tenant() tenant:TenantContext){return this.plans.requestUpgrade(tenant.organizationId,dto.note,tenant.userId);}
 @Get('plans') @RequirePermission([P.ORGANIZATION_LICENSES_VIEW]) list(){return this.plans.list(true);}
 @Post('from-plan') @RequirePermission([P.ORGANIZATION_LICENSES_CREATE]) create(@Body() dto:ApplyPlanDto,@Tenant() tenant:TenantContext,@Req() req:Request){if(tenant.accessMode!=='platform_operation')throw new ForbiddenException('Somente o administrador da plataforma pode alterar a licença.');return this.plans.apply(tenant.organizationId,dto,{userId:tenant.userId,ip:req.ip,agent:req.get('user-agent')});}
}
