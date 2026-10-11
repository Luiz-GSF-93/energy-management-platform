import {Body,Controller,Get,Header,Param,Post,Query,Req,StreamableFile,UploadedFile,UseInterceptors} from '@nestjs/common';
import {FileInterceptor} from '@nestjs/platform-express';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {SalesSignedDocumentsService,SIGNED_DOCUMENT_LIMIT,SignedUpload} from './sales-signed-documents.service';
const owner=['82e7fc71-479a-4dd6-8b22-4fba6eaa6841'];
@Controller('admin/sales/signed-documents') @PlatformScope()
export class SalesSignedDocumentsController {
 constructor(private readonly service:SalesSignedDocumentsService){}
 @Get() @RequirePermission(owner) @Header('Cache-Control','no-store')
 list(@Req() r:RequestWithAuthenticatedUser,@Query() q:Record<string,unknown>){return this.service.list(r.authenticatedUser.userId,q);}
 @Post() @RequirePermission(owner) @Header('Cache-Control','no-store')
 @UseInterceptors(FileInterceptor('file',{limits:{fileSize:SIGNED_DOCUMENT_LIMIT,files:1,fields:8,fieldSize:2200}}))
 import(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown,@UploadedFile() f?:SignedUpload){return this.service.import(r.authenticatedUser.userId,b,f);}
 @Post('reviews') @RequirePermission(owner) @Header('Cache-Control','no-store')
 review(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.service.review(r.authenticatedUser.userId,b);}
 @Get(':id/pdf') @RequirePermission(owner) @Header('Cache-Control','no-store') @Header('X-Content-Type-Options','nosniff') @Header('Content-Security-Policy',"sandbox; default-src 'none'")
 async pdf(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string){return new StreamableFile(await this.service.pdf(r.authenticatedUser.userId,id),{type:'application/pdf',disposition:'attachment; filename="energyos-assinatura-externa.pdf"'});}
 @Get(':id') @RequirePermission(owner) @Header('Cache-Control','no-store')
 read(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string){return this.service.read(r.authenticatedUser.userId,id);}
}
