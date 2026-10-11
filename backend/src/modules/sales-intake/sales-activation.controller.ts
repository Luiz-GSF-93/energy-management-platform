import {Body,Controller,Get,Header,Param,Post,Query,Req} from '@nestjs/common';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {SALES_OWNER} from './sales-finance.service';
import {SalesActivationService} from './sales-activation.service';
@Controller('admin/sales/activation-preparations') @PlatformScope() @RequirePermission([SALES_OWNER])
export class SalesActivationController {
 constructor(private readonly service:SalesActivationService){}
 @Get() @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') list(@Req() r:RequestWithAuthenticatedUser,@Query() q:Record<string,unknown>){return this.service.list(r.authenticatedUser.userId,q);}
 @Get(':id') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') read(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string){return this.service.read(r.authenticatedUser.userId,id);}
 @Post() @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') prepare(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.service.prepare(r.authenticatedUser.userId,b);}
 @Post('reviews') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') review(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.service.review(r.authenticatedUser.userId,b);}
}
