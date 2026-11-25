import {BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {createHash,timingSafeEqual} from 'node:crypto';
import {SupabaseService} from '../../services/supabase.service';

const uuid=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const ref=/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/;
export function bridgeBody(action:string,input:unknown){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new BadRequestException('Protocolo de integração inválido.');
 const b=input as Record<string,unknown>;
 const fields:Record<string,string[]>={claim:['requestId'],ack:['receipt','leaseId','coreRequestId'],update:['eventId','receipt','revision','status','proposalRef','contractRef'],routing:['enabled','reason'],retry:['receipt','reason']};
 if(!fields[action]||Object.keys(b).some(k=>!fields[action].includes(k)))throw new BadRequestException('Campo fora do contrato da integração.');
 const validId=(k:string)=>typeof b[k]==='string'&&uuid.test(b[k] as string);
 const reason=()=>typeof b.reason==='string'&&b.reason.trim().length>=20&&b.reason.length<=1000;
 if(action==='claim'&&!validId('requestId')||action==='ack'&&(!validId('receipt')||!validId('leaseId')||typeof b.coreRequestId!=='string'||!ref.test(b.coreRequestId))||action==='routing'&&(typeof b.enabled!=='boolean'||!reason())||action==='retry'&&(!validId('receipt')||!reason()))throw new BadRequestException('Confira o protocolo e a justificativa.');
 if(action==='update'&&(!validId('eventId')||!validId('receipt')||!Number.isSafeInteger(b.revision)||Number(b.revision)<1||Number(b.revision)>1000000||!['PROPOSAL_PREPARED','CONTRACT_PREPARED','CONTRACT_SIGNED','CANCELLED'].includes(String(b.status))||['proposalRef','contractRef'].some(k=>b[k]!==undefined&&(typeof b[k]!=='string'||!ref.test(b[k] as string)))))throw new BadRequestException('Atualização comercial inválida.');
 if(action==='update'&&(b.status==='PROPOSAL_PREPARED'&&!b.proposalRef||['CONTRACT_PREPARED','CONTRACT_SIGNED'].includes(String(b.status))&&!b.contractRef))throw new BadRequestException('Informe a referência comercial no Energy Core.');
 return Object.fromEntries(fields[action].filter(k=>b[k]!==undefined).map(k=>[k,typeof b[k]==='string'?String(b[k]).trim():b[k]]));
}
@Injectable()
export class SalesCoreBridgeService{
 constructor(private db:SupabaseService,private config:ConfigService){}
 private authenticate(token:unknown){
  if(this.config.get('SALES_CORE_BRIDGE_ENABLED')!=='true')throw new ServiceUnavailableException('Integração Energy Core ainda não habilitada.');
  const secret=this.config.get<string>('SALES_CORE_BRIDGE_TOKEN');
  if(!secret||!/^\S{43,255}$/.test(secret)||secret===this.config.get('SUPABASE_SERVICE_KEY')||secret===this.config.get('SALES_ASAAS_SANDBOX_API_KEY')||secret===this.config.get('SALES_ASAAS_SANDBOX_WEBHOOK_TOKEN'))throw new ServiceUnavailableException('Credencial exclusiva da integração não configurada.');
  if(typeof token!=='string'||token.length>262)throw new ForbiddenException('Integração não autorizada.');
  const expected=Buffer.from('Bearer '+secret),received=Buffer.from(token);
  if(expected.length!==received.length||!timingSafeEqual(expected,received))throw new ForbiddenException('Integração não autorizada.');
 }
 private async rpc(actor:string|null,action:string,body:unknown){
  let result:any;try{result=await this.db.getClient().rpc('platform_sales_core_bridge',{p_actor:actor,p_action:action,p_body:body});}catch{throw new ServiceUnavailableException('Comunicação não confirmada. Consulte o mesmo protocolo antes de repetir.');}
  if(result.error){const c=result.error.code;if(c==='42501')throw new ForbiddenException('Operação não autorizada.');if(c==='P3650')throw new ConflictException('Protocolo, versão ou prazo de processamento mudou.');if(c==='P3651')throw new NotFoundException('Solicitação comercial não localizada.');if(c==='22023')throw new BadRequestException('Dados da integração inválidos.');throw new ServiceUnavailableException('Comunicação não confirmada. Consulte o mesmo protocolo antes de repetir.');}return result.data;
 }
 async core(action:'claim'|'ack'|'update',token:unknown,input:unknown){
  this.authenticate(token);const body=bridgeBody(action,input);
  return this.rpc(null,action,action==='update'?{...body,digest:createHash('sha256').update(JSON.stringify(body)).digest('hex')}:body);
 }
 owner(actor:string,action:'status'|'routing'|'retry',body:unknown={}){return this.rpc(actor,action,action==='status'?{}:bridgeBody(action,body));}
}
