import {PortalNotificationsWorker} from './portal-notifications.worker';
import {WhatsappTemplatesService} from '../whatsapp-delivery/whatsapp-templates.service';
import {PortalAutomationWorker} from './portal-automation.worker';
import {Body,Controller,Get,Header,Module,Param,Post,Query,UploadedFile,UseInterceptors} from '@nestjs/common';
import {FileInterceptor} from '@nestjs/platform-express';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {SupabaseService} from '../../services/supabase.service';
import {LicensesModule} from '../licenses/licenses.module';
import {OcrModule} from '../ocr/ocr.module';
import {DocumentsService} from '../documents/services/documents.service';
import {DocumentFile,MAX_DOCUMENT_BYTES} from '../documents/services/document-file';
import {PortalWorkspaceService} from './portal-workspace.service';
@Controller('portal/workspace')
class PortalWorkspaceController {
 constructor(private service:PortalWorkspaceService){}
 @Get('context') @Header('Cache-Control','no-store') context(@Tenant() t:TenantContext){return this.service.action(t,'context');}
 @Get('service-context') @Header('Cache-Control','no-store') serviceContext(@Tenant() t:TenantContext){return this.service.action(t,'service_context');}
 @Get('invoices') @Header('Cache-Control','no-store') invoices(@Tenant() t:TenantContext){return this.service.list(t);}
 @Post('uploads') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:MAX_DOCUMENT_BYTES,files:1,fields:6,fieldSize:256,parts:7}})) upload(@Tenant() t:TenantContext,@Body() b:any,@UploadedFile() f:DocumentFile){return this.service.upload(t,b,f);}
 @Get('invoices/:id/readout') @Header('Cache-Control','no-store') readout(@Tenant() t:TenantContext,@Param('id') id:string,@Query() q:Record<string,string>){return this.service.readout(t,id,q);}
 @Get('invoices/:id/file') @Header('Cache-Control','no-store') file(@Tenant() t:TenantContext,@Param('id') id:string){return this.service.file(t,id);}
 @Get('requests') @Header('Cache-Control','no-store') requests(@Tenant() t:TenantContext){return this.service.action(t,'requests');}
 @Post('requests') request(@Tenant() t:TenantContext,@Body() b:any){return this.service.action(t,'request',null,b);}
 @Get('preferences') @Header('Cache-Control','no-store') preferences(@Tenant() t:TenantContext){return this.service.action(t,'preferences');}
 @Post('preferences') savePreferences(@Tenant() t:TenantContext,@Body() b:any){return this.service.action(t,'preferences',null,b);}
 @Get('notifications') @Header('Cache-Control','no-store') notifications(@Tenant() t:TenantContext){return this.service.action(t,'notifications');}
 @Post('notifications/:id/read') read(@Tenant() t:TenantContext,@Param('id') id:string){return this.service.action(t,'read',id);}
}
@Controller('operations/portal-routing')
class PortalRoutingController {
 constructor(private service:PortalWorkspaceService){}
 @Get() @Header('Cache-Control','no-store') read(@Tenant() t:TenantContext){return this.service.action(t,'routing');}
 @Post() save(@Tenant() t:TenantContext,@Body() b:any){return this.service.action(t,'routing',null,b);}
}
@Module({imports:[LicensesModule,OcrModule],controllers:[PortalWorkspaceController,PortalRoutingController],providers:[SupabaseService,DocumentsService,PortalWorkspaceService,PortalAutomationWorker,PortalNotificationsWorker,WhatsappTemplatesService],exports:[PortalWorkspaceService]})
export class PortalWorkspaceModule{}
