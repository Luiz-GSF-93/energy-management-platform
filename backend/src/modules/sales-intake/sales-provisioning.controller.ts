import {Body,Controller,Get,Header,Param,Post,Query,Req} from '@nestjs/common';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {SALES_OWNER} from './sales-finance.service';
import {SalesProvisioningService} from './sales-provisioning.service';
@Controller('admin/sales/provisioning') @PlatformScope() @RequirePermission([SALES_OWNER])
export class SalesProvisioningController {
 constructor(private readonly service:SalesProvisioningService){}
 @Get() @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') list(@Req() r:RequestWithAuthenticatedUser,@Query() q:Record<string,unknown>){return this.service.list(r.authenticatedUser.userId,q);}
 @Get(':id') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') read(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string){return this.service.read(r.authenticatedUser.userId,id);}
 @Post('preview') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') preview(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.service.preview(r.authenticatedUser.userId,b);}
 @Post() @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') prepare(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.service.prepare(r.authenticatedUser.userId,b);}
 @Post('authorize') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') authorize(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.service.command(r.authenticatedUser.userId,'authorize',b);}
 @Post('withdraw') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') withdraw(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.service.command(r.authenticatedUser.userId,'withdraw',b);}
 @Post('execute') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') execute(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.service.command(r.authenticatedUser.userId,'execute',b);}
}
