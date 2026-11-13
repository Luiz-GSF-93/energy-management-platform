import {BadRequestException,Body,ConflictException,Controller,ForbiddenException,Get,Header,Injectable,Post,Query,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {EvaAssistedClosingService} from './eva-assisted-closing.service';
import {resolutionId} from './ocr-resolution-plan';
const uuid=(s:any)=>typeof s==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s);
@Injectable()
export class EvaDocumentReviewService{
 constructor(private db:SupabaseService,private closing:EvaAssistedClosingService,private config:ConfigService){}
 private allowed(t:TenantContext){if(t.scope!=='organization'||!t.organizationId||!t.userId||!t.roleId||t.portalCustomerScope||t.accessMode||!['admin_org','gestor','operacional'].includes(t.role))throw new ForbiddenException('Fila disponível à equipe interna da organização.');}
 private async rpc(t:TenantContext,action:string,body:any){const r=await this.db.getClient().rpc('eva_document_review_queue',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_action:action,p_body:body});if(r.error){if(r.error.code==='42501')throw new ForbiddenException('Permissão ou etapa de conferência indisponível.');if(['PT409','40001','23505','22023','22P02'].includes(r.error.code))throw new ConflictException('A proposta mudou. A EVA precisa carregar a versão atual antes de confirmar o envio.');throw new ServiceUnavailableException('Resultado não confirmado. A EVA consultará o protocolo antes de outro envio.');}return r.data;}
 async read(t:TenantContext,q:any={},status=false){this.allowed(t);if(this.config.get('EVA_ASSISTED_CLOSING_ENABLED')!=='true')return {enabled:false,rows:[]};
  if(status){if(Object.keys(q).join(',')!=='closingId'||!uuid(q.closingId))throw new BadRequestException('Informe a proposta desta conferência.');return this.rpc(t,'status',q);}
  if(Object.keys(q).some(k=>!['stage','page'].includes(k))||q.stage!==undefined&&!['ALL','OPERATOR','APPROVAL','INPUT','RETURNED','PUBLICATION','REVISION'].includes(q.stage)||q.page!==undefined&&!/^\d{1,5}$/.test(q.page))throw new BadRequestException('Filtro da fila inválido.');return this.rpc(t,'list',{stage:q.stage??'ALL',page:Number(q.page??0)});
 }
 async act(t:TenantContext,action:'submit'|'return',b:any){this.allowed(t);if(this.config.get('EVA_ASSISTED_CLOSING_ENABLED')!=='true')throw new ForbiddenException('Apuração EVA indisponível.');
  if(!b||typeof b!=='object'||Object.keys(b).sort().join(',')!=='closingId,confirmed,hash,reason,requestId'||!uuid(b.closingId)||!uuid(b.requestId)||!/^[a-f0-9]{64}$/.test(b.hash??'')||b.confirmed!==true||typeof b.reason!=='string'||b.reason.trim().length<20||b.reason.length>1000)throw new BadRequestException('Confirme a proposta, a justificativa e o protocolo.');
  if(action==='submit'){
   const status=await this.rpc(t,'status',{closingId:b.closingId}),r=status.row;
   if(!status.canSubmit||!r||r.hash!==b.hash||!r.approvalEligible||!['OPERATOR','RETURNED','REVISION'].includes(r.stage))throw new ConflictException('Conclua a conferência da versão atual antes de enviar.');
   const fresh=await this.closing.prepare({consumerUnitId:r.unitId,month:r.month,scopeKind:r.scopeKind,requestId:resolutionId(['eva-document-review-submit',t.organizationId,b.requestId])},t);
   if(fresh.row?.id!==b.closingId||fresh.row?.payload_hash!==b.hash)throw new ConflictException('A EVA atualizou as fontes. Confira a nova versão carregada antes de enviar ao gestor.');
  }
  return this.rpc(t,action,b);
 }
}
@Controller('eva-assisted-closing/review-queue')
export class EvaDocumentReviewController{
 constructor(private reviews:EvaDocumentReviewService){}
 @Get() @Header('Cache-Control','private, no-store') list(@Tenant()t:TenantContext,@Query()q:any){return this.reviews.read(t,q);}
 @Get('status') @Header('Cache-Control','private, no-store') status(@Tenant()t:TenantContext,@Query()q:any){return this.reviews.read(t,q,true);}
 @Post('submit') submit(@Tenant()t:TenantContext,@Body()b:any){return this.reviews.act(t,'submit',b);}
 @Post('return') back(@Tenant()t:TenantContext,@Body()b:any){return this.reviews.act(t,'return',b);}
}
