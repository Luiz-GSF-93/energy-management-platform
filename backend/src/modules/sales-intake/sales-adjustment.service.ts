import {BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
import {commercialInput} from './sales-commercial.service';

@Injectable()
export class SalesAdjustmentService {
 constructor(private readonly db:SupabaseService,private readonly config:ConfigService){}
 private async rpc(actor:string,action:string,body:unknown):Promise<any>{
  if(this.config.get('SALES_ADJUSTMENT_PREPARATION_ENABLED')!=='true')throw new ServiceUnavailableException('Solicitações internas desligadas.');
  let r:any;try{r=await this.db.getClient().rpc('platform_sales_adjustment_action',{p_actor:actor,p_action:action,p_body:body});}catch{throw new ServiceUnavailableException('Solicitações indisponíveis; confira o histórico antes de repetir.');}
  if(r.error){if(r.error.code==='42501')throw new ForbiddenException('Perfil sem autorização.');if(r.error.code==='P3700')throw new NotFoundException('Fonte não localizada.');if(['P3701','23505'].includes(r.error.code))throw new ConflictException('Fonte, versão ou evidência divergente. Confira o histórico e as pendências.');if(['22023','22P02','22003','23514','22007','22008'].includes(r.error.code))throw new BadRequestException('Dados inválidos.');throw new ServiceUnavailableException('Solicitações indisponíveis; preserve o registro.');}return r.data;
 }
 private id(id:string){commercialInput({id},['id'],['id']);}
 private origin(origin:unknown){if(!['ONCE','CYCLE','SUBSCRIPTION'].includes(String(origin)))throw new BadRequestException('Origem inválida.');}
 private note(note:unknown){if(typeof note!=='string'||note.trim().length<20||note.length>500)throw new BadRequestException('Justificativa entre 20 e 500 caracteres exigida.');}
 private page(q:Record<string,unknown>,allowed:string[]){if(Object.entries(q).some(([k,v])=>!allowed.includes(k)||typeof v!=='string')||!/^\d{1,4}$/.test(String(q.page??'0'))||Number(q.page??0)>1000)throw new BadRequestException('Filtros inválidos.');return Number(q.page??0);}
 private parameters(value:unknown,origin?:string){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new BadRequestException('Parâmetros inválidos.');
  const refund=origin?origin!=='SUBSCRIPTION':Object.prototype.hasOwnProperty.call(value,'amountCents');
  const b=commercialInput(value,refund?['amountCents']:['requestedDate','conditionsReviewed','noticeDays','conditionsEvidence'],[]);
  if(refund){if(!Number.isSafeInteger(b.amountCents)||Number(b.amountCents)<1||Number(b.amountCents)>9999999999)throw new BadRequestException('Valor inválido em centavos.');}
  else if(typeof b.requestedDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.requestedDate)||typeof b.conditionsReviewed!=='boolean'||!Number.isInteger(b.noticeDays)||Number(b.noticeDays)<0||Number(b.noticeDays)>365||typeof b.conditionsEvidence!=='string'||b.conditionsEvidence.length>1000)throw new BadRequestException('Condições de cancelamento inválidas.');
  return b;
 }
 async list(actor:string,q:Record<string,unknown>){const page=this.page(q,['page','search','state']);if(String(q.search??'').length>100||!['','PREPARED','WAITING_EVIDENCE','CONFIRMED_INTERNAL','REJECTED','WITHDRAWN'].includes(String(q.state??'')))throw new BadRequestException('Filtros inválidos.');return this.rpc(actor,'list',{page,search:q.search??'',state:q.state??''});}
 async read(actor:string,id:string,q:Record<string,unknown>){this.id(id);return this.rpc(actor,'read',{id,page:this.page(q,['page'])});}
 async source(actor:string,origin:string,id:string){this.origin(origin);this.id(id);return this.rpc(actor,'source',{origin,id});}
 async prepare(actor:string,body:unknown){const b=commercialInput(body,['id','origin','sourceId','parameters','justification'],['id','sourceId']);this.origin(b.origin);this.note(b.justification);return this.rpc(actor,'prepare',{...b,parameters:this.parameters(b.parameters,String(b.origin))});}
 async transition(actor:string,id:string,action:string,body:unknown){this.id(id);if(!['revise','confirm','reject','withdraw'].includes(action))throw new BadRequestException('Ação inválida.');const b=commercialInput(body,action==='revise'?['commandId','expectedVersion','parameters','justification']:['commandId','expectedVersion','justification'],['commandId']);this.note(b.justification);if(!Number.isInteger(b.expectedVersion)||Number(b.expectedVersion)<1||Number(b.expectedVersion)>999999)throw new BadRequestException('Versão inválida.');return this.rpc(actor,action,{...b,id,...(action==='revise'?{parameters:this.parameters(b.parameters)}:{})});}
}
