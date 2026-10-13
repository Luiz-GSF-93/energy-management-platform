import {Body,Controller,Get,Header,Param,Post,Query,Req} from '@nestjs/common';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {EVA_GUIDE_OWNER,EvaGuidePublicationService} from './eva-guide-publication.service';
@Controller('admin/eva/product-guides') @PlatformScope()
export class EvaGuidePublicationController {
 constructor(private service:EvaGuidePublicationService){}
 @Get() @RequirePermission([EVA_GUIDE_OWNER]) @Header('Cache-Control','no-store') list(@Req() r:RequestWithAuthenticatedUser,@Query() q:Record<string,unknown>){return this.service.list(r.authenticatedUser.userId,q);}
 @Get(':key') @RequirePermission([EVA_GUIDE_OWNER]) @Header('Cache-Control','no-store') detail(@Req() r:RequestWithAuthenticatedUser,@Param('key') key:string,@Query() q:Record<string,unknown>){return this.service.detail(r.authenticatedUser.userId,key,q);}
 @Post(':key/publish') @RequirePermission([EVA_GUIDE_OWNER]) @Header('Cache-Control','no-store') publish(@Req() r:RequestWithAuthenticatedUser,@Param('key') key:string,@Body() b:unknown){return this.service.command(r.authenticatedUser.userId,key,'publish',b);}
 @Post(':key/quarantine') @RequirePermission([EVA_GUIDE_OWNER]) @Header('Cache-Control','no-store') quarantine(@Req() r:RequestWithAuthenticatedUser,@Param('key') key:string,@Body() b:unknown){return this.service.command(r.authenticatedUser.userId,key,'quarantine',b);}
}
