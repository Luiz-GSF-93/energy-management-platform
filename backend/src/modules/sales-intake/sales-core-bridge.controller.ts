import {Body,Controller,Get,Header,Headers,HttpCode,Post,Req} from '@nestjs/common';
import {Public} from '../../common/decorators/public.decorator';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {SalesCoreBridgeService} from './sales-core-bridge.service';
@Controller('integrations/energy-core/sales')
export class SalesCoreBridgeController{
 constructor(private bridge:SalesCoreBridgeService){}
 @Post('claim') @Public() @HttpCode(200) @Header('Cache-Control','no-store') claim(@Headers('authorization') token:unknown,@Body() b:unknown){return this.bridge.core('claim',token,b);}
 @Post('ack') @Public() @HttpCode(200) @Header('Cache-Control','no-store') ack(@Headers('authorization') token:unknown,@Body() b:unknown){return this.bridge.core('ack',token,b);}
 @Post('updates') @Public() @HttpCode(200) @Header('Cache-Control','no-store') update(@Headers('authorization') token:unknown,@Body() b:unknown){return this.bridge.core('update',token,b);}
}
@Controller('admin/sales/energy-core') @PlatformScope()
export class OwnerSalesCoreBridgeController{
 constructor(private bridge:SalesCoreBridgeService){}
 @Get() @RequirePermission(['82e7fc71-479a-4dd6-8b22-4fba6eaa6841']) @Header('Cache-Control','no-store') status(@Req() r:RequestWithAuthenticatedUser){return this.bridge.owner(r.authenticatedUser.userId,'status');}
 @Post('routing') @RequirePermission(['82e7fc71-479a-4dd6-8b22-4fba6eaa6841']) @Header('Cache-Control','no-store') routing(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.bridge.owner(r.authenticatedUser.userId,'routing',b);}
 @Post('retry') @RequirePermission(['82e7fc71-479a-4dd6-8b22-4fba6eaa6841']) @Header('Cache-Control','no-store') retry(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.bridge.owner(r.authenticatedUser.userId,'retry',b);}
}
