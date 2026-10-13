import {BadRequestException,Body,Controller,Get,Header,Param,Post,Query,Req,UploadedFile,UseInterceptors} from '@nestjs/common';
import {FileInterceptor} from '@nestjs/platform-express';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {EVA_GUIDE_OWNER} from './eva-guide-publication.service';
import {EvaOfficialDocumentService} from './eva-official-document.service';
import {OriginalFile,ORIGINAL_LIMIT} from './eva-official-document.model';
@Controller('admin/eva/official-documents') @PlatformScope()
export class EvaOfficialDocumentController {
 constructor(private service:EvaOfficialDocumentService){}
 @Get() @RequirePermission([EVA_GUIDE_OWNER]) @Header('Cache-Control','no-store') list(@Req() r:RequestWithAuthenticatedUser,@Query() q:Record<string,unknown>){return this.service.list(r.authenticatedUser.userId,q)}
 @Get(':id') @RequirePermission([EVA_GUIDE_OWNER]) @Header('Cache-Control','no-store') detail(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Query() q:Record<string,unknown>){return this.service.detail(r.authenticatedUser.userId,id,q)}
 @Post() @RequirePermission([EVA_GUIDE_OWNER]) @Header('Cache-Control','no-store') prepare(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.service.prepare(r.authenticatedUser.userId,null,b)}
 @Post(':id/revisions') @RequirePermission([EVA_GUIDE_OWNER]) @Header('Cache-Control','no-store') revise(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Body() b:unknown){return this.service.prepare(r.authenticatedUser.userId,id,b)}
 @Post(':id/original') @RequirePermission([EVA_GUIDE_OWNER]) @Header('Cache-Control','no-store')
 @UseInterceptors(FileInterceptor('file',{limits:{fileSize:ORIGINAL_LIMIT,files:1,fields:1,fieldSize:4000,parts:2}}))
 upload(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Body() b:Record<string,unknown>,@UploadedFile() f:OriginalFile){let command:unknown;if(Object.keys(b??{}).length!==1||typeof b?.command!=='string')throw new BadRequestException('Comando de upload inválido.');try{command=JSON.parse(b.command)}catch{throw new BadRequestException('Comando de upload inválido.')}return this.service.upload(r.authenticatedUser.userId,id,command,f)}
 @Post(':id/storage/:operationId/reconcile') @RequirePermission([EVA_GUIDE_OWNER]) @Header('Cache-Control','no-store') reconcile(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Param('operationId') operationId:string,@Body() b:unknown){return this.service.reconcile(r.authenticatedUser.userId,id,operationId,b)}
}
