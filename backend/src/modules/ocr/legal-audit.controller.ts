import {Body,Controller,Get,Header,HttpCode,Param,Post,Query,Req} from '@nestjs/common';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {RequestWithTenant} from '../../common/interfaces/tenant-context.interface';
import {LegalAuditService} from './legal-audit.service';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {EVA_GUIDE_OWNER} from './eva-guide-publication.service';
@Controller('legal-audit')
export class LegalAuditController{
 constructor(private service:LegalAuditService){}
 @Get('settings') @Header('Cache-Control','no-store') @RequirePermission([P.DOCUMENTS_VIEW]) settings(@Req()r:RequestWithTenant){return this.service.settings(r.tenantContext!);}
 @Get('library') @Header('Cache-Control','no-store') @RequirePermission([P.DOCUMENTS_VIEW]) library(@Req()r:RequestWithTenant){return this.service.library(r.tenantContext!);}
 @Get('performance') @Header('Cache-Control','no-store') @RequirePermission([P.DOCUMENTS_VIEW]) metrics(@Req()r:RequestWithTenant,@Query('from')from:string){return this.service.metrics(r.tenantContext!,from);}
 @Get() @Header('Cache-Control','no-store') @RequirePermission([P.DOCUMENTS_VIEW]) list(@Req()r:RequestWithTenant){return this.service.action(r.tenantContext!,'list',null);}
 @Post() @HttpCode(202) @RequirePermission([P.DOCUMENTS_VIEW,P.ENERGIA_OCR_PROCESS,P.INTELLIGENCE_AI_USE]) enqueue(@Req()r:RequestWithTenant,@Body()b:any){return this.service.enqueue(r.tenantContext!,b);}
 @Get(':id') @Header('Cache-Control','no-store') @RequirePermission([P.DOCUMENTS_VIEW]) detail(@Req()r:RequestWithTenant,@Param('id')id:string){return this.service.detail(r.tenantContext!,id);}
 @Post(':id/review') @RequirePermission([P.DOCUMENTS_VIEW,P.ENERGIA_OCR_PROCESS]) review(@Req()r:RequestWithTenant,@Param('id')id:string,@Body()b:any){return this.service.confirmReview(r.tenantContext!,id,b);}
 @Post(':id/resume') @RequirePermission([P.DOCUMENTS_VIEW,P.ENERGIA_OCR_PROCESS,P.INTELLIGENCE_AI_USE]) resume(@Req()r:RequestWithTenant,@Param('id')id:string){return this.service.resume(r.tenantContext!,id);}
 @Post(':id/questions') @RequirePermission([P.DOCUMENTS_VIEW,P.INTELLIGENCE_AI_USE]) question(@Req()r:RequestWithTenant,@Param('id')id:string,@Body()b:any){return this.service.question(r.tenantContext!,id,b);}
}
@Controller('admin/eva/legal-library') @PlatformScope()
export class LegalAuditOwnerController{
 constructor(private service:LegalAuditService){}
 private context(r:RequestWithAuthenticatedUser):any{return {scope:'global',userId:r.authenticatedUser.userId,roleId:'',permissions:[],role:'admin_platform'};}
 @Get() @Header('Cache-Control','no-store') @RequirePermission([EVA_GUIDE_OWNER]) list(@Req()r:RequestWithAuthenticatedUser){return this.service.library(this.context(r));}
 @Post() @RequirePermission([EVA_GUIDE_OWNER]) publish(@Req()r:RequestWithAuthenticatedUser,@Body()b:any){return this.service.publishSource(this.context(r),b);}
}
