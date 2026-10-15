import {BadRequestException,Body,Controller,Get,Header,Param,Post,Query,Req,UploadedFile,UseInterceptors} from '@nestjs/common';
import {FileInterceptor} from '@nestjs/platform-express';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {EVA_GUIDE_OWNER} from './eva-guide-publication.service';
import {EvaPageCurationService} from './eva-page-curation.service';
@Controller('admin/eva/page-curations') @PlatformScope()
export class EvaPageCurationController{
 constructor(private service:EvaPageCurationService){}
 @Get(':id') @RequirePermission([EVA_GUIDE_OWNER]) @Header('Cache-Control','no-store') detail(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Query() q:Record<string,unknown>){return this.service.detail(r.authenticatedUser.userId,id,q);}
 @Post(':id') @RequirePermission([EVA_GUIDE_OWNER]) @Header('Cache-Control','no-store') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:2*1024*1024,files:1,fields:1,fieldSize:4000,parts:2}}))
 prepare(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Body() b:Record<string,unknown>,@UploadedFile() f:{buffer:Buffer;size:number}){if(!b||Object.keys(b).length!==1||typeof b.command!=='string')throw new BadRequestException('Comando inválido.');let command:unknown;try{command=JSON.parse(b.command);}catch{throw new BadRequestException('Comando inválido.');}return this.service.import(r.authenticatedUser.userId,id,command,f);}
}
