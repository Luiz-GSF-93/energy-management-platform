import {Body,Controller,Get,Header,Post,Query,Req} from '@nestjs/common';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {SALES_OWNER} from './sales-finance.service';
import {SalesClicksignConnectionService} from './sales-clicksign-connection.service';
@Controller('admin/sales/clicksign-connection') @PlatformScope() @RequirePermission([SALES_OWNER])
export class SalesClicksignConnectionController {
 constructor(private readonly service:SalesClicksignConnectionService){}
 @Get() @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') list(@Req() r:RequestWithAuthenticatedUser,@Query() q:Record<string,unknown>){return this.service.list(r.authenticatedUser.userId,q);}
 @Post('check') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') check(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.service.check(r.authenticatedUser.userId,b);}
}
