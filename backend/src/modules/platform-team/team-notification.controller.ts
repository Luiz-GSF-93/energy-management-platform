import {Body,Controller,Get,Header,Param,ParseUUIDPipe,Post,Query,RawBodyRequest,Req} from '@nestjs/common';
import {Request} from 'express';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {Public} from '../../common/decorators/public.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {TEAM_MANAGE,PLATFORM_COSTS_VIEW} from './platform-team.permissions';
import {TeamNotificationService} from './team-notification.service';
@Controller('admin/platform-team-notifications') @PlatformScope()
export class TeamNotificationController{
 constructor(private readonly service:TeamNotificationService){}
 @Get() @Header('Cache-Control','no-store') @RequirePermission([TEAM_MANAGE]) list(@Req() req:RequestWithAuthenticatedUser,@Query() q:Record<string,string>){return this.service.list(req.authenticatedUser.userId,q);}
 @Get(':id') @Header('Cache-Control','no-store') @RequirePermission([TEAM_MANAGE]) detail(@Req() req:RequestWithAuthenticatedUser,@Param('id',new ParseUUIDPipe()) id:string,@Query() q:Record<string,string>){return this.service.list(req.authenticatedUser.userId,q,id);}
 @Post('prepare/:user') @RequirePermission([TEAM_MANAGE]) prepare(@Req() req:RequestWithAuthenticatedUser,@Param('user',new ParseUUIDPipe()) user:string,@Body() b:unknown){return this.service.prepare(req.authenticatedUser.userId,user,(b as any)?.reason);}
 @Post(':id/retry') @RequirePermission([TEAM_MANAGE]) retry(@Req() req:RequestWithAuthenticatedUser,@Param('id',new ParseUUIDPipe()) id:string,@Body() b:unknown){return this.service.retry(req.authenticatedUser.userId,id,(b as any)?.reason);}
}
@Controller('webhooks/platform-team-resend')
export class TeamNotificationWebhookController{
 constructor(private readonly service:TeamNotificationService){}
 @Public() @Post() @Header('Cache-Control','no-store') receive(@Req() req:RawBodyRequest<Request>){return this.service.webhook(req.rawBody!,req.headers);}
}
@Controller('admin/platform-team-notification-metrics') @PlatformScope()
export class TeamNotificationMetricsController{
 constructor(private readonly service:TeamNotificationService){}
 @Get() @Header('Cache-Control','no-store') @RequirePermission([PLATFORM_COSTS_VIEW]) metrics(@Req() req:RequestWithAuthenticatedUser,@Query('month') month:string){return this.service.metrics(req.authenticatedUser.userId,month);}
}
