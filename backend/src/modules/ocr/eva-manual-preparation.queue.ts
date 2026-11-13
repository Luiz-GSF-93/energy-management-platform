import {manualPreparationCommand} from './eva-manual-receipt';
import {BadRequestException,ConflictException,ForbiddenException,Injectable,ServiceUnavailableException,HttpException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {wakeEvaWorkers} from '../../common/workers/eva-poller';
import {readRpc} from '../../common/services/read-deadline';
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
export type ManualPreparationJob={id:string;state:'QUEUED'|'RUNNING'|'SUCCEEDED'|'FAILED'|'UNKNOWN';consumerUnitId:string;customerId:string;month:string;scopeKind:'UNIT'|'CUSTOMER';generation:number;closingId:string|null;errorCode:string|null;createdAt:string;updatedAt:string};
@Injectable()
export class EvaManualPreparationQueue{
 constructor(private db:SupabaseService,private config:ConfigService){}
 enabled(){return this.config.get('EVA_MANUAL_PREPARATION_ASYNC_ENABLED')==='true';}
 accepting(){return this.config.get('EVA_MANUAL_PREPARATION_ACCEPTING')!=='false';}
 availableFor(t:TenantContext){return this.enabled()&&!t.accessMode&&!t.portalCustomerScope&&['admin_org','gestor','operacional'].includes(t.role);}
 async operations(q:any,t:TenantContext){
  if(!q||Object.keys(q).some(k=>!['filter','page'].includes(k))||q.filter!==undefined&&!['ALL','ACTIVE','ATTENTION','SUCCEEDED'].includes(q.filter)||q.page!==undefined&&(typeof q.page!=='string'||!/^\d{1,4}$/.test(q.page)))throw new BadRequestException('Filtro da fila de preparação inválido.');
  if(!t.organizationId||!t.userId||!t.roleId||t.portalCustomerScope||!['admin_org','gestor','operacional'].includes(t.role))throw new ForbiddenException('Painel exclusivo da equipe interna autorizada.');
  if(!this.enabled())return {enabled:false};
  const r=await readRpc(this.db.getClient(),'eva_manual_preparation_operations',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_platform:t.accessMode==='platform_operation',p_filter:q.filter??'ALL',p_offset:Number(q.page??0)*25},8000);
  if(r.error?.code==='42501')throw new ForbiddenException('Vínculo, licença ou permissão de consulta indisponível.');
  if(r.error||!r.data||r.data.organizationId!==t.organizationId||!Array.isArray(r.data.rows))throw new ServiceUnavailableException('A consulta da fila não foi confirmada. Os protocolos permanecem preservados.');
  return {...r.data,enabled:true,accepting:this.accepting()};
 }
 private scope(q:any){
  if(!q||Object.keys(q).some(k=>!['consumerUnitId','month','scopeKind','requestId','jobId','reason','confirmed'].includes(k))||!uuid(q.consumerUnitId)||typeof q.month!=='string'||!/^(20|21)\d{2}-(0[1-9]|1[0-2])$/.test(q.month)||!['UNIT','CUSTOMER'].includes(q.scopeKind??'CUSTOMER'))throw new BadRequestException('Confira unidade, competência e escopo da preparação.');
  return {p_unit:q.consumerUnitId,p_month:q.month,p_scope:q.scopeKind??'CUSTOMER'};
 }
 private async action(action:'request'|'status'|'reconcile',q:any,t:TenantContext){
  if(!this.availableFor(t)||!t.organizationId||!t.userId||!t.roleId)throw new ForbiddenException('Fila de preparação indisponível neste contexto.');
  const args={p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_action:action,...this.scope(q),p_id:action==='request'?q.requestId:q.jobId??null,p_body:action==='reconcile'?{reason:q.reason.trim(),confirmed:true}:{}};
  const r=action==='status'?await readRpc(this.db.getClient(),'eva_manual_preparation_action',args,8000):await manualPreparationCommand(this.db.getClient(),'eva_manual_preparation_action',args);
  if(r.error?.code==='42501')throw new ForbiddenException('Vínculo, licença ou permissão de preparação indisponível.');
  if(r.error?.code==='P3410')throw new HttpException('A fila desta organização atingiu o limite. Acompanhe as solicitações existentes antes de iniciar outras.',429);
  if(r.error&&['40001','23505'].includes(r.error.code))throw new ConflictException('O protocolo ou uma gravação anterior exige reconferência. Consulte o andamento antes de repetir.');
  if(r.error?.code==='22023')throw new BadRequestException('Dados do protocolo de preparação inválidos.');
  if(r.error)throw new ServiceUnavailableException('Solicitação não confirmada. Consulte o andamento; não inicie outra preparação para repetir a mesma ação.');
  if(!r.data||!Object.prototype.hasOwnProperty.call(r.data,'job'))throw new ServiceUnavailableException('Andamento não confirmado. Preserve o protocolo e consulte novamente.');
  if(action!=='status')wakeEvaWorkers();
  return {enabled:true,available:true,accepting:this.accepting(),...r.data};
 }
 async request(b:any,t:TenantContext){
  if(!this.accepting())throw new ServiceUnavailableException('Novas preparações estão pausadas nesta implantação. Os protocolos existentes continuam disponíveis para acompanhamento.');
  if(!b||Object.keys(b).some(k=>!['consumerUnitId','month','scopeKind','requestId'].includes(k))||!uuid(b.requestId))throw new BadRequestException('Protocolo de preparação inválido.');
  return this.action('request',b,t);
 }
 async status(q:any,t:TenantContext){
  if(!q||Object.keys(q).some(k=>!['consumerUnitId','month','scopeKind','jobId'].includes(k))||q.jobId!==undefined&&!uuid(q.jobId))throw new BadRequestException('Consulta do protocolo inválida.');
  return this.action('status',q,t);
 }
 async forHistory(q:any,t:TenantContext){
  if(!this.availableFor(t))return {enabled:false,available:true,accepting:false,job:null};
  try{return await this.status(q,t);}catch(e){if((e as any)?.getStatus?.()!==503)throw e;return {enabled:true,available:false,accepting:this.accepting(),job:null};}
 }
 async reconcile(b:any,t:TenantContext){
  if(!b||Object.keys(b).some(k=>!['consumerUnitId','month','scopeKind','jobId','reason','confirmed'].includes(k))||!uuid(b.jobId)||b.confirmed!==true||typeof b.reason!=='string'||b.reason.trim().length<20||b.reason.length>1000)throw new BadRequestException('Confirme o protocolo e justifique a reconferência com 20 a 1000 caracteres.');
  return this.action('reconcile',b,t);
 }
}
