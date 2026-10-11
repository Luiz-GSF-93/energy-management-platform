import {BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {randomUUID} from 'node:crypto';
import {SupabaseService} from '../../services/supabase.service';
import {commercialInput} from './sales-commercial.service';
import {SalesCycleAdapter} from './sales-cycle.adapter';
@Injectable()
export class SalesCycleService {
 constructor(private readonly db:SupabaseService,private readonly config:ConfigService,private readonly adapter:SalesCycleAdapter){}
 private async rpc(actor:string,action:string,body:unknown):Promise<any>{
  if(this.config.get('SALES_CYCLE_CHECKS_ENABLED')!=='true')throw new ServiceUnavailableException('Conciliação de ciclos desligada.');
  let r:any;try{r=await this.db.getClient().rpc('platform_sales_cycle_action',{p_actor:actor,p_action:action,p_body:body});}catch{throw new ServiceUnavailableException('Conciliação indisponível.');}
  if(r.error){if(r.error.code==='42501')throw new ForbiddenException('Perfil sem autorização.');if(r.error.code==='P3680')throw new NotFoundException('Fonte não localizada.');if(['P3681','23505'].includes(r.error.code))throw new ConflictException('Conferência divergente ou em andamento.');if(['22023','22P02','22003','23514'].includes(r.error.code))throw new BadRequestException('Dados inválidos.');throw new ServiceUnavailableException('Conciliação indisponível.');}return r.data;
 }
 read(actor:string,agreementId:string|undefined,q:Record<string,unknown>){
  if(agreementId!==undefined)commercialInput({agreementId},['agreementId'],['agreementId']);
  if(Object.entries(q).some(([k,v])=>!['page','search','state'].includes(k)||typeof v!=='string')||!/^\d{1,4}$/.test(String(q.page??'0'))||Number(q.page??0)>1000||String(q.search??'').length>100||!['','UNKNOWN','PENDING','OVERDUE','CONFIRMED','RECEIVED','REFUNDED','DELETED'].includes(String(q.state??'')))throw new BadRequestException('Filtros inválidos.');
  return this.rpc(actor,'read',{...(agreementId?{agreementId}:{}),page:Number(q.page??0),search:q.search??'',state:q.state??''}).then(r=>({...r,externalCallsEnabled:this.config.get('SALES_CYCLE_CHECKS_CALLS_ENABLED')==='true'}));
 }
 async check(actor:string,agreementId:string,body:unknown){
  commercialInput({agreementId},['agreementId'],['agreementId']);const b=commercialInput(body,['id','sequence','eventId','justification'],['id','eventId']);
  if(!Number.isInteger(b.sequence)||Number(b.sequence)<2||Number(b.sequence)>13||typeof b.justification!=='string'||b.justification.trim().length<20||b.justification.length>500)throw new BadRequestException('Conferência inválida.');
  if(this.config.get('SALES_CYCLE_CHECKS_CALLS_ENABLED')!=='true')throw new ServiceUnavailableException('Consultas de ciclos desligadas.');
  const lease=randomUUID(),claim=await this.rpc(actor,'claim',{...b,agreementId,lease});
  let summary;try{summary=await this.adapter.payment(claim.paymentId);}catch{
   await this.rpc(actor,'finish',{lease,summary:null});throw new ServiceUnavailableException('Consulta não concluída; tentativa preservada para conferência.');
  }
  return this.rpc(actor,'finish',{lease,summary});
 }
}
