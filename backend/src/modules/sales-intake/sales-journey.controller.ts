import {Body,Controller,Get,Header,Headers,Post,Query,Req} from '@nestjs/common';
import {Request} from 'express';
import {Public} from '../../common/decorators/public.decorator';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {salesRequesterIp} from './sales-intake.ingress';
import {SalesJourneyService} from './sales-journey.service';
@Controller('public/sales/journey')
export class PublicSalesJourneyController{
 constructor(private readonly journey:SalesJourneyService){}
 private context(req:Request,origin:string|undefined,access:string|undefined){return this.journey.boundary(origin,salesRequesterIp(req),access);}
 @Post('state') @Public() @Header('Cache-Control','no-store')
 state(@Body() body:any,@Req() req:Request,@Headers('origin') origin:string|undefined,@Headers('x-sales-access') access:string|undefined){const c=this.context(req,origin,access);return this.journey.state(body?.receipt,c.token);}
 @Post('recommend') @Public() @Header('Cache-Control','no-store')
 recommend(@Body() body:unknown,@Req() req:Request,@Headers('origin') origin:string|undefined,@Headers('x-sales-access') access:string|undefined){const c=this.context(req,origin,access);return this.journey.recommend(body,c.token);}
 @Post('challenge') @Public() @Header('Cache-Control','no-store')
 challenge(@Body() body:unknown,@Req() req:Request,@Headers('origin') origin:string|undefined,@Headers('x-sales-access') access:string|undefined){const c=this.context(req,origin,access);return this.journey.challenge(body,c.token,c.secret);}
 @Post('verify') @Public() @Header('Cache-Control','no-store')
 verify(@Body() body:unknown,@Req() req:Request,@Headers('origin') origin:string|undefined,@Headers('x-sales-access') access:string|undefined){const c=this.context(req,origin,access);return this.journey.verify(body,c.token,c.secret,c.evidence);}
 @Post('accept') @Public() @Header('Cache-Control','no-store')
 accept(@Body() body:unknown,@Req() req:Request,@Headers('origin') origin:string|undefined,@Headers('x-sales-access') access:string|undefined){const c=this.context(req,origin,access);return this.journey.accept(body,c.token,c.evidence);}
}
@Controller('admin/sales/journey') @PlatformScope()
export class OwnerSalesJourneyController{
 constructor(private readonly journey:SalesJourneyService){}
 @Get() @RequirePermission(['82e7fc71-479a-4dd6-8b22-4fba6eaa6841']) @Header('Cache-Control','no-store')
 read(@Req() req:RequestWithAuthenticatedUser,@Query('receipt') receipt:string){return this.journey.owner(req.authenticatedUser.userId,receipt);}
 @Post('approve') @RequirePermission(['82e7fc71-479a-4dd6-8b22-4fba6eaa6841']) @Header('Cache-Control','no-store')
 approve(@Req() req:RequestWithAuthenticatedUser,@Body() body:unknown){return this.journey.approve(req.authenticatedUser.userId,body);}
}
