import {BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {randomUUID} from 'crypto';
import {SupabaseService} from '../../services/supabase.service';
import {commercialInput} from './sales-commercial.service';
import {SalesCreationAdapter} from './sales-creation.adapter';
@Injectable()
export class SalesCreationService {
 constructor(private readonly db:SupabaseService,private readonly config:ConfigService,private readonly adapter:SalesCreationAdapter){}
 private callsEnabled(){try{this.adapter.assertEnabled();return true;}catch{return false;}}
 private enabled(){if(this.config.get('SALES_ASAAS_CREATION_ENABLED')!=='true')throw new ServiceUnavailableException('Preparacao de cobranca sandbox desligada; aguardando homologacao.');}
 private async rpc(actor:string,action:string,body:unknown):Promise<any>{
  this.enabled();let r:any;
  try{r=await this.db.getClient().rpc('platform_sales_creation_action',{p_actor:actor,p_action:action,p_body:body});}catch{throw new ServiceUnavailableException('Registro de tentativa indisponivel.');}
  if(r.error){const c=r.error.code;if(c==='42501')throw new ForbiddenException('Acesso exclusivo ao Owner ativo.');if(['P3640','P3610'].includes(c))throw new NotFoundException('Intencao nao localizada.');if(['P3641','P3611','23505'].includes(c))throw new ConflictException('Primeiro ciclo reservado, tentativa divergente ou reconciliacao necessaria.');if(['22023','22P02','22007','22008','23514'].includes(c))throw new BadRequestException('Dados ou fontes aprovadas invalidos.');throw new ServiceUnavailableException('Registro de tentativa indisponivel.');}
  return r.data;
 }
 list(actor:string,q:Record<string,unknown>){
  if(Object.entries(q).some(([k,v])=>!['page','search','state'].includes(k)||typeof v!=='string')||!/^\d{1,4}$/.test(String(q.page??'0'))||Number(q.page??0)>1000||String(q.search??'').length>100||!['','PREPARED','DISPATCHING','RECONCILIATION','CREATED'].includes(String(q.state??'')))throw new BadRequestException('Filtros invalidos.');
  return this.rpc(actor,'list',{page:Number(q.page??0),search:q.search??'',state:q.state??''}).then(r=>({...r,externalCallsEnabled:this.callsEnabled()}));
 }
 prepare(actor:string,body:unknown){
  const b=commercialInput(body,['id','proposalId','termsRevision','customerId','dueDate','origin','consent'],['id','proposalId']);
  if(!Number.isInteger(b.termsRevision)||Number(b.termsRevision)<1||Number(b.termsRevision)>100000||typeof b.customerId!=='string'||!/^cus_[a-zA-Z0-9]{1,100}$/.test(b.customerId)||typeof b.dueDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.dueDate)||typeof b.origin!=='string'||b.origin.trim().length<5||b.origin.length>500||b.consent!==true)throw new BadRequestException('Pagador, origem, consentimento ou revisao invalidos.');
  return this.rpc(actor,'prepare',b);
 }
 read(actor:string,id:string){commercialInput({id},['id'],['id']);return this.rpc(actor,'read',{id}).then(r=>({...r,externalCallsEnabled:this.callsEnabled()}));}
 async execute(actor:string,id:string,reconcile=false){
  commercialInput({id},['id'],['id']);this.enabled();this.adapter.assertEnabled();
  const lease=randomUUID(),claim=await this.rpc(actor,reconcile?'reconcile':'claim',{id,lease});
  if(claim.skip)return {state:'CREATED',paymentId:claim.paymentId};
  let summary:unknown=null;
  try{summary=await (reconcile?this.adapter.reconcile(claim.parameters):this.adapter.create(claim.parameters));}catch{
   await this.rpc(actor,'finish',{id,lease,summary:null});
   throw new ServiceUnavailableException('Tentativa preservada para reconciliacao; nao repetir criacao.');
  }
  return this.rpc(actor,'finish',{id,lease,summary});
 }
}
