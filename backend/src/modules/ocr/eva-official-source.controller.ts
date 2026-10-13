import {Body,Controller,Get,Header,Param,Post,Query,Req} from '@nestjs/common';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {EVA_GUIDE_OWNER} from './eva-guide-publication.service';
import {EvaOfficialSourceService} from './eva-official-source.service';
@Controller('admin/eva/official-sources') @PlatformScope()
export class EvaOfficialSourceController {
 constructor(private service:EvaOfficialSourceService){}
 @Get() @RequirePermission([EVA_GUIDE_OWNER]) @Header('Cache-Control','no-store') list(@Req() r:RequestWithAuthenticatedUser,@Query() q:Record<string,unknown>){return this.service.list(r.authenticatedUser.userId,q)}
 @Get(':id') @RequirePermission([EVA_GUIDE_OWNER]) @Header('Cache-Control','no-store') detail(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Query() q:Record<string,unknown>){return this.service.detail(r.authenticatedUser.userId,id,q)}
 @Post() @RequirePermission([EVA_GUIDE_OWNER]) @Header('Cache-Control','no-store') create(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.service.command(r.authenticatedUser.userId,null,'create',b)}
 @Post(':id/revisions') @RequirePermission([EVA_GUIDE_OWNER]) @Header('Cache-Control','no-store') update(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Body() b:unknown){return this.service.command(r.authenticatedUser.userId,id,'update',b)}
 @Post(':id/confirm') @RequirePermission([EVA_GUIDE_OWNER]) @Header('Cache-Control','no-store') confirm(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Body() b:unknown){return this.service.command(r.authenticatedUser.userId,id,'confirm',b)}
 @Post(':id/suspend') @RequirePermission([EVA_GUIDE_OWNER]) @Header('Cache-Control','no-store') suspend(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Body() b:unknown){return this.service.command(r.authenticatedUser.userId,id,'suspend',b)}
 @Post(':id/resume') @RequirePermission([EVA_GUIDE_OWNER]) @Header('Cache-Control','no-store') resume(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Body() b:unknown){return this.service.command(r.authenticatedUser.userId,id,'resume',b)}
}
