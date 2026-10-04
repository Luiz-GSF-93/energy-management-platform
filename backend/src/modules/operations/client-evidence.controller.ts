import {Body,Controller,Get,Header,Param,Post,UploadedFile,UseInterceptors} from '@nestjs/common';
import {FileInterceptor} from '@nestjs/platform-express';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {DocumentFile,MAX_DOCUMENT_BYTES} from '../documents/services/document-file';
import {ClientEvidenceService,EvidenceMessageDto,EvidenceVersionDto} from './client-evidence.service';
@Controller('operations/:kind/:id/evidence')
export class ClientEvidenceController {
 constructor(private service:ClientEvidenceService){}
 @Get() @Header('Cache-Control','private, no-store') thread(@Param('kind') k:string,@Param('id') id:string,@Tenant() t:TenantContext){return this.service.thread(id,t,k);}
 @Post() append(@Param('kind') k:string,@Param('id') id:string,@Body() d:EvidenceMessageDto,@Tenant() t:TenantContext){return this.service.append(id,d,t,k);}
 @Post('upload') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:MAX_DOCUMENT_BYTES,files:1,fields:1,fieldSize:128,parts:2}})) upload(@Param('kind') k:string,@Param('id') id:string,@UploadedFile() f:DocumentFile,@Tenant() t:TenantContext,@Body() d:EvidenceVersionDto){return this.service.upload(id,f,t,k,d);}
 @Get('files/:document') @Header('Cache-Control','private, no-store') download(@Param('kind') k:string,@Param('id') id:string,@Param('document') d:string,@Tenant() t:TenantContext){return this.service.download(id,d,t,k);}
}
@Controller('portal/evidence')
export class PortalEvidenceController {
 constructor(private service:ClientEvidenceService){}
 @Get() @Header('Cache-Control','private, no-store') list(@Tenant() t:TenantContext){return this.service.portalList(t);}
 @Get(':id') @Header('Cache-Control','private, no-store') thread(@Param('id') id:string,@Tenant() t:TenantContext){return this.service.thread(id,t);}
 @Post(':id') append(@Param('id') id:string,@Body() d:EvidenceMessageDto,@Tenant() t:TenantContext){return this.service.append(id,d,t);}
 @Post(':id/opened/:message') opened(@Param('id') id:string,@Param('message') m:string,@Tenant() t:TenantContext){return this.service.opened(id,m,t);}
 @Post(':id/upload') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:MAX_DOCUMENT_BYTES,files:1,fields:1,fieldSize:128,parts:2}})) upload(@Param('id') id:string,@UploadedFile() f:DocumentFile,@Tenant() t:TenantContext,@Body() d:EvidenceVersionDto){return this.service.upload(id,f,t,undefined,d);}
 @Get(':id/files/:document') @Header('Cache-Control','private, no-store') download(@Param('id') id:string,@Param('document') d:string,@Tenant() t:TenantContext){return this.service.download(id,d,t);}
}
