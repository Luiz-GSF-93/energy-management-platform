import {Body,Controller,Get,Param,ParseUUIDPipe,Patch,Post,Req,UsePipes,ValidationPipe} from '@nestjs/common';
import {Request} from 'express';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {PlansService,PLAN_VIEW,PLAN_MANAGE} from './plans.service';
import {ApplyPlanDto,SavePlanDto} from './plans.dto';
const validation=new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true});
@Controller('admin/plans') @PlatformScope() @UsePipes(validation)
export class PlatformPlansController {
 constructor(private readonly plans:PlansService){}
 @Get() @RequirePermission([PLAN_VIEW]) list(){return this.plans.list();}
 @Post() @RequirePermission([PLAN_MANAGE]) create(@Body() dto:SavePlanDto,@Req() req:RequestWithAuthenticatedUser){return this.plans.save(null,dto,{userId:req.authenticatedUser.userId,ip:req.ip,agent:req.get('user-agent')});}
 @Patch(':id') @RequirePermission([PLAN_MANAGE]) update(@Param('id',new ParseUUIDPipe()) id:string,@Body() dto:SavePlanDto,@Req() req:RequestWithAuthenticatedUser){return this.plans.save(id,dto,{userId:req.authenticatedUser.userId,ip:req.ip,agent:req.get('user-agent')});}
}
@Controller('licenses') @UsePipes(validation)
export class OrganizationPlansController {
 constructor(private readonly plans:PlansService){}
 @Get('plans') @RequirePermission([P.ORGANIZATION_LICENSES_VIEW]) list(){return this.plans.list(true);}
 @Post('from-plan') @RequirePermission([P.ORGANIZATION_LICENSES_CREATE]) create(@Body() dto:ApplyPlanDto,@Tenant() tenant:TenantContext,@Req() req:Request){return this.plans.apply(tenant.organizationId,dto,{userId:tenant.userId,ip:req.ip,agent:req.get('user-agent')});}
}
