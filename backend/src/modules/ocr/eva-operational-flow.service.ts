import {EvaPoller} from '../../common/workers/eva-poller';
import {scheduledWorkEnabled} from '../../common/workers/process-role';
import {BadRequestException,ConflictException,Body,Controller,ForbiddenException,Get,Header,Injectable,Logger,OnModuleDestroy,OnModuleInit,Post,Query} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {CalculationAutofillService} from './calculation-autofill.service';
import {EvaAssistedClosingService} from './eva-assisted-closing.service';
import {CceeDataService} from '../ccee/ccee-data.service';
import {CceeDriCostService} from '../ccee/ccee-dri-cost.service';
import {resolutionId} from './ocr-resolution-plan';
import {closingCceeLocal} from './closing-ccee-local';
import {operationalBindingState,operationalReviewReceipt} from './eva-operational-flow.model';

/** Coordinates existing guarded draft services. Never calls OCR, AI or a SOAP transport. */
@Injectable()
export class EvaOperationalFlowService implements OnModuleInit,OnModuleDestroy{
 private poller=new EvaPoller();private stopped=false;private busy=false;private log=new Logger(EvaOperationalFlowService.name);
 constructor(private db:SupabaseService,private closing:EvaAssistedClosingService,private ccee:CceeDataService,private costs:CceeDriCostService,private autofill:CalculationAutofillService){}
 enabled(){return process.env.EVA_CCEE_ORCHESTRATION_ENABLED==='true';}
 async action(t:TenantContext,action:string,b:any={}){
  if(!this.enabled()||t.organizationId!=='org_default')return{enabled:false,rows:[]};
  if(!t.organizationId||!t.userId||t.portalCustomerScope||t.accessMode==='platform_operation'||!['admin_org','gestor','operacional'].includes(t.role))throw new ForbiddenException('Fluxo exclusivo do backoffice da organização.');
  if(!b||typeof b!=='object'||Array.isArray(b)||!['read','configure','status','submit','return','ack_costs','reconcile'].includes(action))throw new BadRequestException('Ação operacional inválida.');
  const {consumerUnitId=null,month=null,...body}=b;
  const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
  const keys:Record<string,string[]>={read:[],status:[],configure:['requestId','reason','enabled','revision','calendarRules','financialRules','discoverBindings','prepareSources'],submit:['requestId','closingId','hash','reason','confirmed'],return:['requestId','closingId','hash','reason','confirmed'],ack_costs:['requestId','costId','revision','reason','confirmed'],reconcile:['requestId','flowId','reason','confirmed']};
  if(Object.keys(body).some(k=>!keys[action].includes(k))||['status','submit','return','ack_costs','reconcile'].includes(action)&&(!uuid(consumerUnitId)||typeof month!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)))throw new BadRequestException('Confira unidade, competência e campos da ação.');
  if(!['read','status'].includes(action)&&(!uuid(body.requestId)||typeof body.reason!=='string'||body.reason.trim().length<20||body.reason.length>(action==='ack_costs'?2000:1000)))throw new BadRequestException('Registre a justificativa e o protocolo desta ação.');
  if(['submit','return'].includes(action)&&(!uuid(body.closingId)||!/^[a-f0-9]{64}$/.test(body.hash??'')||body.confirmed!==true)||action==='ack_costs'&&(!uuid(body.costId)||!Number.isInteger(body.revision)||body.revision<1||body.confirmed!==true))throw new BadRequestException('Confirme a versão e os valores conferidos.');
  if(action==='configure'&&t.role!=='admin_org')throw new ForbiddenException('Somente o administrador configura a automação.');
  if(action==='reconcile'){
   if(t.role!=='admin_org')throw new ForbiddenException('Retomada auditada restrita ao administrador.');
   if(!uuid(body.flowId)||body.confirmed!==true)throw new BadRequestException('Confirme o protocolo que será reconferido.');
   const listed=await this.rpc('eva_flow_action',{p_org:t.organizationId,p_actor:t.userId,p_action:'read'}),run=listed.runs?.find((r:any)=>r.id===body.flowId&&r.consumer_unit_id===consumerUnitId&&r.month===month&&r.state==='UNKNOWN'&&r.kind==='CLOSING');
   if(!run)throw new BadRequestException('Protocolo interrompido indisponível neste recorte.');
   const history=await this.autofill.history({consumerUnitId,month,page:'0'},t),prior=history.rows?.[0];
   if(!prior||prior.state!=='RUNNING')throw new BadRequestException('O histórico da origem exige revisão específica; nenhuma gravação foi repetida.');
   const current=await this.autofill.closingSnapshot({consumerUnitId,month},t);
   if(!current.available||current.basis!==prior.source_basis||current.sourceHash!==prior.source_hash)throw new BadRequestException('A origem mudou; é necessária revisão das fontes antes da retomada.');
   return{enabled:true,...await this.rpc('eva_flow_reconcile_interrupted',{p_org:t.organizationId,p_actor:t.userId,p_run:run.id,p_preparation:prior.id,p_body:{requestId:body.requestId,reason:body.reason.trim(),confirmed:true,currentBasis:current.basis,sourceHash:current.sourceHash}})};
  }
  // Refresh the proposal through the established preparation protocol before
  // submission. A changed result must be shown to the operator, never submitted unseen.
  if(action==='submit'){
   const history=await this.closing.history({consumerUnitId,month,scopeKind:'UNIT',page:'0'},t);
   if(!history.canPrepare||!history.rows?.some((r:any)=>r.id===body.closingId&&r.payload_hash===body.hash&&r.report?.approvalEligible&&r.state==='READY_FOR_REVIEW'))throw new BadRequestException('A proposta selecionada não está pronta ou mudou. Confira o histórico.');
   const fresh=await this.closing.prepare({consumerUnitId,month,scopeKind:'UNIT',requestId:resolutionId(['flow-submit-recheck',t.organizationId,body.requestId])},t);
   if(fresh.row?.id!==body.closingId||fresh.row?.payload_hash!==body.hash)throw new BadRequestException('As fontes foram atualizadas. Confira a nova proposta antes de enviar ao gestor.');
  }
  return{enabled:true,...await this.rpc('eva_flow_action',{p_org:t.organizationId,p_actor:t.userId,p_action:action,p_unit:consumerUnitId,p_month:month,p_body:body})};
 }
 private async rpc(name:string,args:any){const r=process.env.EVA_MANUAL_PREPARATION_ASYNC_ENABLED==='true'&&name==='eva_flow_worker'&&args.p_action==='begin_write'?await this.db.getClient().rpc('eva_coordinated_flow_begin',{p_id:args.p_id,p_lease:args.p_lease}):await this.db.getClient().rpc(name,args);if(r.data?.deferred)throw Error('EVA_FLOW_PREPARATION_SLOT_BUSY');if(r.error){if(r.error.code==='42501')throw new ForbiddenException('Perfil, licença ou responsabilidade operacional indisponível.');if(['22023','40001','23505','22P02'].includes(r.error.code))throw new BadRequestException('O protocolo ou as fontes mudaram. Confira a proposta e sua justificativa.');throw Error('EVA_FLOW_'+name+'_UNCONFIRMED');}return r.data;}
 onModuleInit(){if(!scheduledWorkEnabled('EVA'))return;if(this.enabled())this.schedule();}
 onModuleDestroy(){this.poller.stop();this.stopped=true;}
 private schedule(){if(this.stopped)return;this.poller.start(()=>this.runOnce(),15000,()=>this.log.warn('EVA_FLOW_STEP_PENDING'));}
 async runOnce(){
  if(!this.enabled()||this.busy||this.stopped)return;this.busy=true;
  try{
   const claim=await this.rpc('eva_flow_worker',{p_action:'claim'});if(!claim)return;this.poller.activity();
   const run=claim.run,args={p_id:run.id,p_lease:run.lease_id};let writing=false;
   const finish=(state:string,result:any,error?:string)=>this.rpc('eva_flow_worker',{...args,p_action:'finish',p_body:{state,result,...(error?{error}:{})}});
   try{
    const c=await this.rpc('eva_flow_worker',{...args,p_action:'context'});
    if(c.run.organization_id!=='org_default'||c.policy.organization_id!==c.run.organization_id||c.unit?.organization_id!==c.run.organization_id||c.unit?.customer_id!==c.run.customer_id)throw Error('FLOW_SCOPE_CHANGED');
    const t:TenantContext={scope:'organization',organizationId:run.organization_id,email:'',...c.delegate};
    const binding=operationalBindingState(c.binding,c.discovery,run,c.unit);
    if(run.kind==='UNIT_SYNC'){
     const applied:any[]=[];
     if(binding.state==='AUTHORIZED')for(const rule of c.policy.calendar_rules??[]){
      if(rule.bindingId!==c.binding.id)continue;
      for(const item of c.calendarItems??[]){if(!rule.codes.includes(item.code)||!c.binding.service_scope?.includes('AGENDA')||operationalBindingState(c.binding,null,{...run,month:item.month},c.unit).state!=='AUTHORIZED')continue;
       if(!writing){await this.rpc('eva_flow_worker',{...args,p_action:'begin_write'});writing=true;}
       const result=await this.ccee.applyCalendar(t,{versionId:item.versionId,itemId:item.id,bindingId:rule.bindingId,responsibleId:rule.responsibleId,reason:'Regra de aplicabilidade aprovada: '+rule.sourceReference.slice(0,400)});
       applied.push({id:result.id,code:item.code});
      }
     }
     await finish('WAITING',{binding,calendar:applied,notice:binding.state==='AUTHORIZED'?'Fontes autorizadas acompanhadas pelas políticas de coleta existentes.':'Cadastro verificado; somente a coleta privada aguarda representação comprovada. O preenchimento documental continua.'});return;
    }
    if(c.intakeActive){await finish('WAITING',{binding,notice:'Preparação já em execução no recebimento original. Nenhuma escrita concorrente iniciada.'});return;}
    if(!c.document?.id||!c.document.ocrReady){await finish('WAITING',{binding,notice:'Aguardando uma fatura única com leitura concluída nesta unidade e competência. Nenhuma leitura paga foi repetida.'});return;}
    if(c.policy.prepare_sources&&binding.state==='AUTHORIZED'){
     const local=await closingCceeLocal(this.db.getClient(),t,c.unit,run.month);
     const rules=(c.policy.financial_rules??[]).filter((r:any)=>r.bindingId===c.binding.id);
     for(const candidate of local.candidates??[]){if(candidate.rubric==='GUARANTEE')continue;if(local.candidates.filter((c:any)=>c.rubric===candidate.rubric).length!==1)continue;const rule=rules.find((r:any)=>r.rubrics.includes(candidate.rubric));
      // Only a unique represented unit may receive a whole-agent row.
      // Several units or several rows for a rubric require allocation review.
      if((local as any).allocationAmbiguous)continue;
      if(!writing){await this.rpc('eva_flow_worker',{...args,p_action:'begin_write'});writing=true;}
      try{await this.costs.prepare(t,candidate.jobId,{month:run.month,effect:candidate.suggestedEffect,sourceHash:candidate.sourceHash,reason:'Política auditada de alocação automática: '+(rule?.sourceReference??('Vínculo '+c.binding.id+' revisão '+c.binding.revision+'; rubrica '+candidate.mapVersion+'; única unidade representada para este CNPJ.')).slice(0,550),confirmed:true});}catch(error){if(!(error instanceof BadRequestException||error instanceof ConflictException||error instanceof ForbiddenException))throw error;/* Existing manual/aggregate or changed source is preserved for the second group. */}
     }
    }
    const requestId=resolutionId(['eva-flow-unit-1',run.organization_id,run.id,String(run.claimed_generation)]);
    if(!writing){await this.rpc('eva_flow_worker',{...args,p_action:'begin_write'});writing=true;}
    let prepared:any;
    try{prepared=await this.closing.prepare({consumerUnitId:run.consumer_unit_id,month:run.month,scopeKind:'UNIT',requestId},t);}catch(error){
     // Reconcile only the exact persisted request. A timeout cannot trigger a
     // second financial preparation or claim that a prior version is current.
     const h=await this.closing.history({consumerUnitId:run.consumer_unit_id,month:run.month,scopeKind:'UNIT',page:'0'},t);
     const row=h.rows?.find((r:any)=>r.id===requestId);if(!operationalReviewReceipt(row,run,c.document))throw error;prepared={row};
    }
    if(!operationalReviewReceipt(prepared.row,run,c.document))throw Error('FLOW_RECEIPT_UNCONFIRMED');
    await finish('SUCCEEDED',{closingId:prepared.row.id,binding,needsReview:!prepared.row.report.approvalEligible,notice:prepared.row.report.approvalEligible?'Proposta pronta. O operador pode conferir e enviar ao gestor.':'Valores disponíveis preenchidos. Confira os dois grupos de informações complementares.'});
   }catch(error){
    const code=error instanceof Error&&/^[A-Z][A-Z0-9_]{2,80}$/.test(error.message)?error.message:'SOURCE_OR_ACCESS_REVIEW';
    const unknown=writing&&!(error instanceof BadRequestException||error instanceof ConflictException||error instanceof ForbiddenException);
    await finish(unknown?'UNKNOWN':'WAITING',{notice:unknown?'A confirmação da escrita requer reconciliação do protocolo. Não repita o envio.':'Fonte ou representação indisponível. Os documentos foram preservados.'},code);
   }
  }finally{this.busy=false;}
 }
}
@Controller('eva-assisted-closing/flow')
export class EvaOperationalFlowController{
 constructor(private flow:EvaOperationalFlowService){}
 @Get() @Header('Cache-Control','private, no-store') read(@Tenant()t:TenantContext){return this.flow.action(t,'read');}
 @Get('status') @Header('Cache-Control','private, no-store') status(@Tenant()t:TenantContext,@Query()q:any){return this.flow.action(t,'status',q);}
 @Post('policy') configure(@Tenant()t:TenantContext,@Body()b:any){return this.flow.action(t,'configure',b);}
 @Post('submit') submit(@Tenant()t:TenantContext,@Body()b:any){return this.flow.action(t,'submit',b);}
 @Post('return') return(@Tenant()t:TenantContext,@Body()b:any){return this.flow.action(t,'return',b);}
 @Post('reconcile') reconcile(@Tenant()t:TenantContext,@Body()b:any){return this.flow.action(t,'reconcile',b);}
 @Post('costs') costs(@Tenant()t:TenantContext,@Body()b:any){return this.flow.action(t,'ack_costs',b);}
}
