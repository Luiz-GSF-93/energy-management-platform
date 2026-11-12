import {EvaClosingDialogueService} from './eva-closing-dialogue.service';
import {EvaClosingChangesService} from './eva-closing-changes.service';
import {Body,Controller,Get,Post,Query,Optional,HttpCode,ConflictException} from '@nestjs/common';
import {EvaManualPreparationQueue} from './eva-manual-preparation.queue';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {EvaAssistedClosingService} from './eva-assisted-closing.service';
@Controller('eva-assisted-closing')
export class EvaAssistedClosingController{
 constructor(private service:EvaAssistedClosingService,@Optional() private dialogue?:EvaClosingDialogueService,@Optional() private changes?:EvaClosingChangesService,@Optional() private queue?:EvaManualPreparationQueue){}
 @Get('preparation-requests') @RequirePermission([P.ENERGIA_OCR_PROCESS]) preparationStatus(@Query() q:any,@Tenant() t:TenantContext){return this.queue!.status(q,t);}
 @Post('preparation-requests') @HttpCode(202) @RequirePermission([P.ENERGIA_OCR_PROCESS]) requestPreparation(@Body() b:any,@Tenant() t:TenantContext){return this.queue!.request(b,t);}
 @Post('preparation-requests/reconcile') @RequirePermission([P.ENERGIA_OCR_PROCESS]) reconcilePreparation(@Body() b:any,@Tenant() t:TenantContext){return this.queue!.reconcile(b,t);}
 @Post('changes/preview') @RequirePermission([P.INTELLIGENCE_AI_USE,P.ENERGIA_OCR_PROCESS]) previewChange(@Body() b:any,@Tenant() t:TenantContext){return this.changes!.preview(b,t);}
 @Post('changes/confirm') @RequirePermission([P.INTELLIGENCE_AI_USE,P.ENERGIA_OCR_PROCESS]) confirmChange(@Body() b:any,@Tenant() t:TenantContext){return this.changes!.action(b,t,'confirm');}
 @Post('changes/cancel') @RequirePermission([P.INTELLIGENCE_AI_USE,P.ENERGIA_OCR_PROCESS]) cancelChange(@Body() b:any,@Tenant() t:TenantContext){return this.changes!.action(b,t,'cancel');}
 @Post('changes/status') @RequirePermission([P.INTELLIGENCE_AI_USE,P.ENERGIA_OCR_PROCESS]) changeStatus(@Body() b:any,@Tenant() t:TenantContext){return this.changes!.action(b,t,'status');}
 @Post('changes/history') @RequirePermission([P.INTELLIGENCE_AI_USE,P.ENERGIA_OCR_PROCESS]) changeHistory(@Body() b:any,@Tenant() t:TenantContext){return this.changes!.action(b,t,'history');}
 @Post('dialogue') @RequirePermission([P.INTELLIGENCE_AI_USE]) answer(@Body() b:any,@Tenant() t:TenantContext){return this.dialogue!.answer(b,t);}
 @Get() @RequirePermission([P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW]) async history(@Query() q:any,@Tenant() t:TenantContext){const h=await this.service.history(q,t);if(!h.enabled||!h.canPrepare||!this.queue)return h;const {page,...scope}=q;return {...h,preparationQueue:await this.queue.forHistory(scope,t)};}
 @Post() @RequirePermission([P.ENERGIA_OCR_PROCESS]) prepare(@Body() b:any,@Tenant() t:TenantContext){if(this.queue?.availableFor(t))throw new ConflictException('A preparação agora continua em segundo plano. Atualize a página para solicitar e acompanhar pelo mesmo protocolo. As respostas salvas foram preservadas.');return this.service.prepare(b,t);}
 @Post('publication') @RequirePermission([P.ORGANIZATION_CONTRACTS_UPDATE]) publication(@Body() b:any,@Tenant() t:TenantContext){return this.service.publication(b,t);}
 @Post('decision') @RequirePermission([P.ORGANIZATION_CONTRACTS_UPDATE]) decide(@Body() b:any,@Tenant() t:TenantContext){return this.service.decide(b,t);}
}
