import {Body,Controller,Get,Header,Param,Post,Query,Req} from '@nestjs/common';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {SalesCreationService} from './sales-creation.service';
const owner=['82e7fc71-479a-4dd6-8b22-4fba6eaa6841'];
@Controller('admin/sales/sandbox-creation') @PlatformScope()
export class SalesCreationController {
 constructor(private readonly service:SalesCreationService){}
 @Get() @RequirePermission(owner) @Header('Cache-Control','no-store') list(@Req() r:RequestWithAuthenticatedUser,@Query() q:Record<string,unknown>){return this.service.list(r.authenticatedUser.userId,q);}
 @Get(':id') @RequirePermission(owner) @Header('Cache-Control','no-store') read(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string){return this.service.read(r.authenticatedUser.userId,id);}
 @Post() @RequirePermission(owner) @Header('Cache-Control','no-store') prepare(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.service.prepare(r.authenticatedUser.userId,b);}
 @Post(':id/execute') @RequirePermission(owner) @Header('Cache-Control','no-store') execute(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string){return this.service.execute(r.authenticatedUser.userId,id);}
 @Post(':id/reconcile') @RequirePermission(owner) @Header('Cache-Control','no-store') reconcile(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string){return this.service.execute(r.authenticatedUser.userId,id,true);}
 @Post(':id/recovery-authorization') @RequirePermission(owner) @Header('Cache-Control','no-store') authorizeRecovery(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Body() b:unknown){return this.service.authorizeRecovery(r.authenticatedUser.userId,id,b);}
 @Post(':id/recover') @RequirePermission(owner) @Header('Cache-Control','no-store') recover(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string){return this.service.execute(r.authenticatedUser.userId,id,false,true);}
}
