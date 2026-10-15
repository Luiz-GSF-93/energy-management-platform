import {BadRequestException,Body,Controller,Get,Header,Param,Post,Query,Req,StreamableFile,UploadedFile,UseInterceptors} from '@nestjs/common';
import {FileInterceptor} from '@nestjs/platform-express';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {EVA_GUIDE_OWNER} from './eva-guide-publication.service';
import {EvaDocumentPartsService} from './eva-document-parts.service';
import {OriginalFile} from './eva-official-document.model';
import {PARTS_LIMITS} from './eva-document-parts.model';
const upload=()=>FileInterceptor('file',{limits:{fileSize:PARTS_LIMITS.bytes,files:1,fields:1,fieldSize:4000,parts:2}});
@Controller('admin/eva/document-parts') @PlatformScope()
export class EvaDocumentPartsController{
 constructor(private service:EvaDocumentPartsService){}
 @Get() @RequirePermission([EVA_GUIDE_OWNER]) @Header('Cache-Control','no-store') list(@Req() r:RequestWithAuthenticatedUser,@Query() q:Record<string,unknown>){return this.service.list(r.authenticatedUser.userId,q);}
 @Get(':id') @RequirePermission([EVA_GUIDE_OWNER]) @Header('Cache-Control','no-store') detail(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Query() q:Record<string,unknown>){return this.service.detail(r.authenticatedUser.userId,id,q);}
 @Post() @RequirePermission([EVA_GUIDE_OWNER]) @Header('Cache-Control','no-store') @UseInterceptors(upload())
 prepare(@Req() r:RequestWithAuthenticatedUser,@Body() b:Record<string,unknown>,@UploadedFile() f:OriginalFile){let command:unknown;if(!b||Object.keys(b).length!==1||typeof b.command!=='string')throw new BadRequestException('Comando inválido.');try{command=JSON.parse(b.command);}catch{throw new BadRequestException('Comando inválido.');}return this.service.prepare(r.authenticatedUser.userId,command,f);}
 @Post(':id/parts/:ordinal') @RequirePermission([EVA_GUIDE_OWNER]) @Header('Cache-Control','no-store') @Header('X-Content-Type-Options','nosniff') @UseInterceptors(upload())
 async download(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Param('ordinal') ordinal:string,@Body() b:Record<string,unknown>,@UploadedFile() f:OriginalFile){if(Object.keys(b??{}).length)throw new BadRequestException('Campos inesperados.');return new StreamableFile(await this.service.download(r.authenticatedUser.userId,id,ordinal,f),{type:'application/pdf',disposition:'attachment; filename="eva-parte-'+ordinal+'.pdf"'});}
 @Post(':id/:action') @RequirePermission([EVA_GUIDE_OWNER]) @Header('Cache-Control','no-store') command(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Param('action') action:string,@Body() b:unknown){return this.service.command(r.authenticatedUser.userId,id,action,b);}
}
