import {BadRequestException,ConflictException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {CalculationAutofillService} from './calculation-autofill.service';
import {autofillHash} from './calculation-autofill.model';
import {assistedClosingReport,ClosingEntry} from './eva-assisted-closing.model';
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
@Injectable()
export class EvaAssistedClosingService{
 constructor(private db:SupabaseService,private config:ConfigService,private autofill:CalculationAutofillService){}
 private enabled(){return this.config.get('EVA_ASSISTED_CLOSING_ENABLED')==='true';}
 private scope(q:any){if(!q||Object.keys(q).sort().join(',')!=='consumerUnitId,month'||!uuid(q.consumerUnitId)||typeof q.month!=='string'||!/^(20|21)\d{2}-(0[1-9]|1[0-2])$/.test(q.month))throw new BadRequestException('Unidade e competência inválidas.');return q;}
 private async rpc(action:string,q:any,t:TenantContext,id:string|null,body:any){
  if(!t?.organizationId||!t.userId||!t.roleId)throw new ForbiddenException('Contexto organizacional necessário.');
  const r=await this.db.getClient().rpc('eva_assisted_closing_action',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_platform:t.accessMode==='platform_operation',p_action:action,p_unit:q.consumerUnitId,p_month:q.month,p_id:id,p_body:body});
  if(!r.error&&r.data!=null)return r.data;
  if(r.error?.code==='42501')throw new ForbiddenException('Acesso restrito ao backoffice autorizado.');
  if(['23505','40001'].includes(r.error?.code))throw new ConflictException('As fontes ou a decisão mudaram. Atualize o histórico antes de continuar.');
  if(r.error?.code==='22023')throw new BadRequestException('Dados insuficientes ou decisão inválida.');
  throw new ServiceUnavailableException('Resultado não confirmado. Consulte o histórico antes de repetir.');
 }
 async history(q:any,t:TenantContext){if(!this.enabled())return {enabled:false};const {page='0',...scope}=q;this.scope(scope);if(typeof page!=='string'||!/^\d{1,3}$/.test(page))throw new BadRequestException('Página inválida.');return {enabled:true,unitId:scope.consumerUnitId,month:scope.month,...await this.rpc('history',scope,t,null,{page:Number(page)})};}
 async prepare(b:any,t:TenantContext){
  if(!this.enabled())throw new ServiceUnavailableException('Fechamento assistido desligado.');
  if(!b||Object.keys(b).sort().join(',')!=='consumerUnitId,month,requestId'||!uuid(b.requestId))throw new BadRequestException('Preparação inválida.');
  const q=this.scope({consumerUnitId:b.consumerUnitId,month:b.month});
  const rights=await this.rpc('history',q,t,null,{page:0});if(!rights.canPrepare)throw new ForbiddenException('Sem permissão para preparar.');
  const prior=rights.rows.find((r:any)=>r.id===b.requestId);if(prior)return {row:prior,replayed:true};
  const sources=await this.rpc('capture',q,t,null,{}),all=sources?.financial?.tables?.consumer_units;
  if(!Array.isArray(all)||!all.length||all.length>100||new Set(all.map((u:any)=>u.id)).size!==all.length)throw new ConflictException('Conjunto completo de unidades indisponível.');
  const primary=all.find((u:any)=>u.id===q.consumerUnitId);if(!primary)throw new ForbiddenException('Unidade fora do escopo.');
  const entries:ClosingEntry[]=[];
  for(const u of [...all].sort((a,b)=>a.id.localeCompare(b.id))){
   if(u.organization_id!==t.organizationId||u.customer_id!==primary.customer_id)throw new ForbiddenException('Fontes fora do escopo.');
   if(u.status!=='ACTIVE'){entries.push({unitId:u.id,name:u.name??u.id,unavailable:'Unidade inativa exige conferência da cobertura do cliente.'});continue;}
   const c=await this.autofill.closingSnapshot({consumerUnitId:u.id,month:q.month},t);
   const uncertain=(sources.commercial??[]).some((r:any)=>r.consumer_unit_id===u.id&&['RUNNING','UNKNOWN'].includes(r.state));
   entries.push(c.available?{unitId:u.id,name:u.name??u.id,plan:c.plan,context:c.c,...(uncertain?{unavailable:'Há uma reserva de preparação comercial ainda não confirmada. Confira o histórico da origem antes de decidir.'}:{})}:{unitId:u.id,name:u.name??u.id,unavailable:c.observation});
  }
  const report=assistedClosingReport(t.organizationId,primary.customer_id,q.month,entries),hash=autofillHash(report),basis=autofillHash({version:1,report,sources});
  const r=await this.rpc('reserve',q,t,b.requestId,{basis,hash,report,sources});
  if(!r.acquired)return {row:r.row,replayed:true};
  return {row:await this.rpc('finish',q,t,r.row.id,{}),replayed:false};
 }
 async decide(b:any,t:TenantContext){
  if(!this.enabled())throw new ServiceUnavailableException('Fechamento assistido desligado.');
  if(!b||Object.keys(b).sort().join(',')!=='acknowledge,consumerUnitId,decision,hash,id,month,note'||!uuid(b.id)||typeof b.hash!=='string'||!/^[a-f0-9]{64}$/.test(b.hash)||!['APPROVE','REJECT'].includes(b.decision)||b.acknowledge!==true||typeof b.note!=='string'||b.note.trim().length<20||b.note.length>2000)throw new BadRequestException('Confirme a decisão e sua justificativa.');
  return {row:await this.rpc('decide',this.scope({consumerUnitId:b.consumerUnitId,month:b.month}),t,b.id,{hash:b.hash,decision:b.decision,note:b.note.trim(),acknowledge:true})};
 }
}
