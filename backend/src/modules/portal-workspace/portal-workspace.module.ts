import {AutomaticIntakeService} from './automatic-intake.service';
import {PortalCustomerAccessController} from './portal-customer-access';
import {AutomaticIntakeWorker} from './automatic-intake.worker';
import {PortalPresentationService} from './portal-presentation.service';
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
 constructor(private service:PortalWorkspaceService,private presentation:PortalPresentationService,private automatic:AutomaticIntakeService){}
 @Get('automatic-intakes') @Header('Cache-Control','no-store') automaticList(@Tenant() t:TenantContext,@Query() q:any){return this.automatic.list(t,q);}
 @Post('automatic-intakes') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:MAX_DOCUMENT_BYTES,files:1,fields:5,fieldSize:256,parts:6}})) automaticUpload(@Tenant() t:TenantContext,@Body() b:any,@UploadedFile() f:DocumentFile){return this.automatic.upload(t,b,f);}
 @Post('automatic-intakes/:id/retry') automaticRetry(@Tenant() t:TenantContext,@Param('id') id:string,@Body() b:any){return this.automatic.retry(t,id,b);}
 @Post('automatic-intakes/:id/dismiss') automaticDismiss(@Tenant() t:TenantContext,@Param('id') id:string,@Body() b:any){return this.automatic.dismiss(t,id,b);}
 @Post('automatic-intakes/:id/resolve') automaticResolve(@Tenant() t:TenantContext,@Param('id') id:string,@Body() b:any){return this.automatic.resolve(t,id,b);}
 @Get('automatic-intakes/:id/content') @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff') automaticContent(@Tenant() t:TenantContext,@Param('id') id:string){return this.automatic.content(t,id);}
 @Get('presentation/identity') @Header('Cache-Control','no-store') identity(@Tenant() t:TenantContext){return this.presentation.action(t,'identity');}
 @Get('presentation/usage') @Header('Cache-Control','no-store') usage(@Tenant() t:TenantContext,@Query() q:Record<string,string>){return this.presentation.usage(t,q);}
 @Get('presentation/requests') @Header('Cache-Control','no-store') compactRequests(@Tenant() t:TenantContext,@Query() q:Record<string,string>){return this.presentation.action(t,'requests',null,q);}
 @Get('presentation/notices') @Header('Cache-Control','no-store') notices(@Tenant() t:TenantContext,@Query() q:Record<string,string>){return this.presentation.action(t,'notices',null,q);}
 @Get('invoices/:id/details') @Header('Cache-Control','no-store') details(@Tenant() t:TenantContext,@Param('id') id:string){return this.presentation.invoice(t,id);}
 @Post('invoices/:id/payment-declaration') declaration(@Tenant() t:TenantContext,@Param('id') id:string,@Body() body:unknown){return this.presentation.declare(t,id,body);}
 @Get('context') @Header('Cache-Control','no-store') context(@Tenant() t:TenantContext){return this.service.action(t,'context');}
 @Get('service-context') @Header('Cache-Control','no-store') serviceContext(@Tenant() t:TenantContext){return this.service.action(t,'service_context');}
 @Post('invoices/library') @Header('Cache-Control','no-store') library(@Tenant() t:TenantContext,@Body() b:any){return this.service.library(t,b);}
 @Get('invoices/:id/content') @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff') content(@Tenant() t:TenantContext,@Param('id') id:string){return this.service.content(t,id);}
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
@Module({imports:[LicensesModule,OcrModule],controllers:[PortalWorkspaceController,PortalRoutingController,PortalCustomerAccessController],providers:[AutomaticIntakeService,AutomaticIntakeWorker,PortalPresentationService,SupabaseService,DocumentsService,PortalWorkspaceService,PortalAutomationWorker,PortalNotificationsWorker,WhatsappTemplatesService],exports:[PortalWorkspaceService]})
export class PortalWorkspaceModule{}
