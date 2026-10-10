import {BadRequestException,Body,Controller,Get,Header,Post,Query,Req} from '@nestjs/common';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {SalesCommercialService} from './sales-commercial.service';
@Controller('admin/sales/commercial') @PlatformScope()
export class SalesCommercialController{
 constructor(private readonly sales:SalesCommercialService){}
 @Get() @RequirePermission(['82e7fc71-479a-4dd6-8b22-4fba6eaa6841']) @Header('Cache-Control','no-store')
 read(@Req() req:RequestWithAuthenticatedUser,@Query() q:Record<string,unknown>){if(Object.keys(q).some(k=>k!=='receipt')||q.receipt!==undefined&&typeof q.receipt!=='string')throw new BadRequestException('Filtros inválidos.');return this.sales.read(req.authenticatedUser.userId,q.receipt as string|undefined);}
 @Post('policies') @RequirePermission(['82e7fc71-479a-4dd6-8b22-4fba6eaa6841']) @Header('Cache-Control','no-store')
 policy(@Req() req:RequestWithAuthenticatedUser,@Body() body:unknown){return this.sales.policy(req.authenticatedUser.userId,body);}
 @Post('proposals') @RequirePermission(['82e7fc71-479a-4dd6-8b22-4fba6eaa6841']) @Header('Cache-Control','no-store')
 proposal(@Req() req:RequestWithAuthenticatedUser,@Body() body:unknown){return this.sales.proposal(req.authenticatedUser.userId,body);}
 @Post('reviews') @RequirePermission(['82e7fc71-479a-4dd6-8b22-4fba6eaa6841']) @Header('Cache-Control','no-store')
 review(@Req() req:RequestWithAuthenticatedUser,@Body() body:unknown){return this.sales.review(req.authenticatedUser.userId,body);}
}
