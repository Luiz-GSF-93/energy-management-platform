import {Body,Controller,Get,Header,Param,Post,Query,Req} from '@nestjs/common';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {EVA_GUIDE_OWNER} from './eva-guide-publication.service';
import {PLAN_VIEW} from '../plans/plans.service';
import {PLATFORM_COSTS_VIEW} from '../platform-team/platform-team.permissions';
import {EvaCompositeService} from './eva-composite.service';
@Controller('admin/eva/composite-releases') @PlatformScope()
export class EvaCompositeController{
 constructor(private service:EvaCompositeService){}
 @Get() @RequirePermission([EVA_GUIDE_OWNER]) @Header('Cache-Control','no-store') list(@Req() r:RequestWithAuthenticatedUser,@Query() q:Record<string,unknown>){return this.service.list(r.authenticatedUser.userId,q);}
 @Get('candidates') @RequirePermission([EVA_GUIDE_OWNER]) @Header('Cache-Control','no-store') candidates(@Req() r:RequestWithAuthenticatedUser,@Query() q:Record<string,unknown>){return this.service.list(r.authenticatedUser.userId,q,true);}
 @Get('metrics') @RequirePermission([PLAN_VIEW,PLATFORM_COSTS_VIEW]) @Header('Cache-Control','no-store') metrics(@Req() r:RequestWithAuthenticatedUser,@Query() q:Record<string,unknown>){return this.service.metrics(r.authenticatedUser.userId,q);}
 @Get(':id') @RequirePermission([EVA_GUIDE_OWNER]) @Header('Cache-Control','no-store') detail(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Query() q:Record<string,unknown>){return this.service.detail(r.authenticatedUser.userId,id,q);}
 @Get(':id/chunks') @RequirePermission([EVA_GUIDE_OWNER]) @Header('Cache-Control','no-store') preview(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Query() q:Record<string,unknown>){return this.service.preview(r.authenticatedUser.userId,id,q);}
 @Post() @RequirePermission([EVA_GUIDE_OWNER]) @Header('Cache-Control','no-store') prepare(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.service.prepare(r.authenticatedUser.userId,b);}
 @Post(':id/:action') @RequirePermission([EVA_GUIDE_OWNER]) @Header('Cache-Control','no-store') command(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Param('action') action:string,@Body() b:unknown){return this.service.command(r.authenticatedUser.userId,id,action,b);}
}
