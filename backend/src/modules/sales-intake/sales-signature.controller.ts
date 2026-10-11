import {Body,Controller,Get,Header,Param,Post,Query,Req} from '@nestjs/common';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {SALES_OWNER} from './sales-finance.service';
import {SalesSignatureService} from './sales-signature.service';
import {SalesSignatureDispatchService} from './sales-signature-dispatch.service';
@Controller('admin/sales/signatures') @PlatformScope() @RequirePermission([SALES_OWNER])
export class SalesSignatureController {
 constructor(private readonly service:SalesSignatureService,private readonly dispatch:SalesSignatureDispatchService){}
 @Get(':id/creation') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') creation(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string){return this.dispatch.read(r.authenticatedUser.userId,id);}
 @Post('creation/next') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') next(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.dispatch.next(r.authenticatedUser.userId,b);}
 @Get() @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') list(@Req() r:RequestWithAuthenticatedUser,@Query() q:Record<string,unknown>){return this.service.list(r.authenticatedUser.userId,q);}
 @Get(':id') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') read(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string){return this.service.read(r.authenticatedUser.userId,id);}
 @Post() @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') prepare(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.service.prepare(r.authenticatedUser.userId,b);}
 @Post('withdraw') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') withdraw(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.service.withdraw(r.authenticatedUser.userId,b);}
}
