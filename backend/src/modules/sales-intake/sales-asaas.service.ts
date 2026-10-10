import {BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {createHash,timingSafeEqual,randomUUID} from 'crypto';
import {SupabaseService} from '../../services/supabase.service';
import {commercialInput} from './sales-commercial.service';
import {SalesAsaasAdapter,paymentSummary,paymentId} from './sales-asaas.adapter';
const eventId=/^evt_[a-zA-Z0-9&_-]{1,150}$/;
@Injectable()
export class SalesAsaasService {
 constructor(private readonly db:SupabaseService,private readonly config:ConfigService,private readonly adapter:SalesAsaasAdapter){}
 private enabled(){if(this.config.get('SALES_ASAAS_SANDBOX_ENABLED')!=='true')throw new ServiceUnavailableException('Integração Asaas sandbox desligada; aguardando homologação.');}
 private async rpc(actor:string|null,action:string,body:unknown){
  this.enabled();let result:any;
  try{result=await this.db.getClient().rpc('platform_sales_asaas_action',{p_actor:actor,p_action:action,p_body:body});}catch{throw new ServiceUnavailableException('Financeiro sandbox indisponível.');}
  if(result.error){const code=result.error.code;if(code==='42501')throw new ForbiddenException('Acesso exclusivo ao Owner ativo.');if(code==='P3610')throw new NotFoundException('Registro sandbox não localizado.');if(['P3611','23505'].includes(code))throw new ConflictException('Registro alterado ou evento divergente. Atualize.');if(['22023','22P02','23514','22003'].includes(code))throw new BadRequestException('Dados sandbox inválidos.');throw new ServiceUnavailableException('Financeiro sandbox indisponível.');}
  return result.data;
 }
 list(actor:string,q:Record<string,unknown>){
  if(Object.entries(q).some(([k,v])=>!['page','search','status','from','to'].includes(k)||typeof v!=='string')||!/^\d{1,4}$/.test(String(q.page??'0'))||Number(q.page??0)>1000||String(q.search??'').length>100||!['','PENDING','VERIFIED','REVIEW','UNLINKED','PROCESSING'].includes(String(q.status??''))||['from','to'].some(k=>q[k]!==undefined&&!/^\d{4}-\d{2}-\d{2}$/.test(String(q[k]))))throw new BadRequestException('Filtros inválidos.');
  return this.rpc(actor,'list',{page:Number(q.page??0),search:q.search??'',status:q.status??'',from:q.from??null,to:q.to??null});
 }
 bind(actor:string,body:unknown){const b=commercialInput(body,['id','proposalId','paymentId','customerId','justification'],['id','proposalId']);if(typeof b.paymentId!=='string'||!paymentId.test(b.paymentId)||typeof b.customerId!=='string'||!/^cus_[a-zA-Z0-9]{1,100}$/.test(b.customerId)||typeof b.justification!=='string'||b.justification.trim().length<5||b.justification.length>1000)throw new BadRequestException('Vínculo sandbox inválido.');return this.rpc(actor,'bind',b);}
 read(actor:string,id:string){commercialInput({id},['id'],['id']);return this.rpc(actor,'read',{id});}
 async webhook(token:unknown,body:unknown){
  this.enabled();const secret=this.config.get<string>('SALES_ASAAS_SANDBOX_WEBHOOK_TOKEN');
  if(!secret||secret.length<32||secret.length>255||/\s/.test(secret)||secret===this.config.get('SALES_ASAAS_SANDBOX_API_KEY'))throw new ServiceUnavailableException('Webhook sandbox não configurado.');
  if(typeof token!=='string'||Buffer.byteLength(token)!==Buffer.byteLength(secret)||!timingSafeEqual(Buffer.from(token),Buffer.from(secret)))throw new ForbiddenException('Webhook não autorizado.');
  if(!body||typeof body!=='object'||Array.isArray(body)||Buffer.byteLength(JSON.stringify(body))>16384)throw new BadRequestException('Evento inválido ou acima do limite.');
  const b=body as Record<string,unknown>;
  if(typeof b.id!=='string'||!eventId.test(b.id)||typeof b.event!=='string'||!/^PAYMENT_[A-Z_]{1,60}$/.test(b.event))throw new BadRequestException('Evento de cobrança inválido.');
  const summary=paymentSummary(b.payment);
  // Allowlist: never persist contacts, document numbers, links, tokens or full remote payloads.
  const event={id:b.id,event:b.event,payment:summary};
  await this.rpc(null,'inbox',{event,hash:createHash('sha256').update(JSON.stringify(event)).digest('hex')});
  return {received:true};
 }
 async verify(actor:string,id:string){
  commercialInput({id},['id'],['id']);
  // Authorization/persistence precede the external GET. A lease allows recovery after interruption.
  const lease=randomUUID(),claim=await this.rpc(actor,'claim',{id,lease});
  if(claim.skip)return {status:claim.status};
  let summary:unknown=null;
  try{summary=await this.adapter.payment(claim.paymentId);}catch{await this.rpc(actor,'finish',{id,lease,summary:null});throw new ServiceUnavailableException('Consulta externa não concluída; evento continua em análise.');}
  return this.rpc(actor,'finish',{id,lease,summary});
 }
}
