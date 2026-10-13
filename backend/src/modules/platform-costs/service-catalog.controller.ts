import {Body,Controller,Get,Param,Post,Query,Req} from '@nestjs/common';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {PLAN_MANAGE,PLAN_VIEW} from '../plans/plans.service';
import {PLATFORM_COSTS_VIEW} from '../platform-team/platform-team.permissions';
import {CostServiceCatalogService} from './service-catalog.service';
@Controller('admin/platform-costs/services') @PlatformScope()
export class CostServiceCatalogController{
 constructor(private catalog:CostServiceCatalogService){}
 @Get() @RequirePermission([PLAN_VIEW,PLATFORM_COSTS_VIEW]) list(@Req()r:RequestWithAuthenticatedUser,@Query()q:Record<string,unknown>){return this.catalog.list(r.authenticatedUser.userId,q);}
 @Get('presets') @RequirePermission([PLAN_VIEW,PLATFORM_COSTS_VIEW]) presets(@Req()r:RequestWithAuthenticatedUser,@Query('month')month:string){return this.catalog.presets(r.authenticatedUser.userId,month);}
 @Get(':id') @RequirePermission([PLAN_VIEW,PLATFORM_COSTS_VIEW]) detail(@Req()r:RequestWithAuthenticatedUser,@Param('id')id:string,@Query()q:Record<string,unknown>){return this.catalog.detail(r.authenticatedUser.userId,id,q);}
 @Post() @RequirePermission([PLAN_MANAGE]) create(@Req()r:RequestWithAuthenticatedUser,@Body()b:unknown){return this.catalog.save(r.authenticatedUser.userId,null,b);}
 @Post(':id/revisions') @RequirePermission([PLAN_MANAGE]) revise(@Req()r:RequestWithAuthenticatedUser,@Param('id')id:string,@Body()b:unknown){return this.catalog.save(r.authenticatedUser.userId,id,b);}
}
