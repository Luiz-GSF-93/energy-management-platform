import {Body,Controller,Get,Patch,Post,Query,Req,UsePipes,ValidationPipe} from '@nestjs/common';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {PLAN_MANAGE,PLAN_VIEW} from '../plans/plans.service';
import {CostPolicyDto,InfrastructureCostDto} from './platform-costs.dto';
import {PlatformCostsService} from './platform-costs.service';
import {PLATFORM_COSTS_VIEW} from '../platform-team/platform-team.permissions';
@Controller('admin/platform-costs') @PlatformScope() @UsePipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true}))
export class PlatformCostsController {
 constructor(private costs:PlatformCostsService){}
 @Get() @RequirePermission([PLAN_VIEW,PLATFORM_COSTS_VIEW]) summary(@Query('month') month?:string){return this.costs.summary(month);}
 @Patch('policy') @RequirePermission([PLAN_MANAGE]) policy(@Body() dto:CostPolicyDto,@Req() req:RequestWithAuthenticatedUser){return this.costs.save('policy',dto,req.authenticatedUser.userId);}
 @Post('infrastructure') @RequirePermission([PLAN_MANAGE]) cost(@Body() dto:InfrastructureCostDto,@Req() req:RequestWithAuthenticatedUser){return this.costs.save('infrastructure',dto,req.authenticatedUser.userId);}
}
