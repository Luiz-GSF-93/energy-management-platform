import {EvaClosingDialogueService} from './eva-closing-dialogue.service';
import {EvaClosingChangesService} from './eva-closing-changes.service';
import {Body,Controller,Get,Post,Query,Optional} from '@nestjs/common';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {EvaAssistedClosingService} from './eva-assisted-closing.service';
@Controller('eva-assisted-closing')
export class EvaAssistedClosingController{
 constructor(private service:EvaAssistedClosingService,@Optional() private dialogue?:EvaClosingDialogueService,@Optional() private changes?:EvaClosingChangesService){}
 @Post('changes/preview') @RequirePermission([P.INTELLIGENCE_AI_USE,P.ENERGIA_OCR_PROCESS]) previewChange(@Body() b:any,@Tenant() t:TenantContext){return this.changes!.preview(b,t);}
 @Post('changes/confirm') @RequirePermission([P.INTELLIGENCE_AI_USE,P.ENERGIA_OCR_PROCESS]) confirmChange(@Body() b:any,@Tenant() t:TenantContext){return this.changes!.action(b,t,'confirm');}
 @Post('changes/cancel') @RequirePermission([P.INTELLIGENCE_AI_USE,P.ENERGIA_OCR_PROCESS]) cancelChange(@Body() b:any,@Tenant() t:TenantContext){return this.changes!.action(b,t,'cancel');}
 @Post('changes/status') @RequirePermission([P.INTELLIGENCE_AI_USE,P.ENERGIA_OCR_PROCESS]) changeStatus(@Body() b:any,@Tenant() t:TenantContext){return this.changes!.action(b,t,'status');}
 @Post('changes/history') @RequirePermission([P.INTELLIGENCE_AI_USE,P.ENERGIA_OCR_PROCESS]) changeHistory(@Body() b:any,@Tenant() t:TenantContext){return this.changes!.action(b,t,'history');}
 @Post('dialogue') @RequirePermission([P.INTELLIGENCE_AI_USE]) answer(@Body() b:any,@Tenant() t:TenantContext){return this.dialogue!.answer(b,t);}
 @Get() @RequirePermission([P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW]) history(@Query() q:any,@Tenant() t:TenantContext){return this.service.history(q,t);}
 @Post() @RequirePermission([P.ENERGIA_OCR_PROCESS]) prepare(@Body() b:any,@Tenant() t:TenantContext){return this.service.prepare(b,t);}
 @Post('decision') @RequirePermission([P.ORGANIZATION_CONTRACTS_UPDATE]) decide(@Body() b:any,@Tenant() t:TenantContext){return this.service.decide(b,t);}
}
