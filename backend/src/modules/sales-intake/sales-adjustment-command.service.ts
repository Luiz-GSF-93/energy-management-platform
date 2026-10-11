import {BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
import {commercialInput} from './sales-commercial.service';
import {SalesAdjustmentCheckAdapter,queryDiagnostic} from './sales-adjustment-check.adapter';
import {SalesAdjustmentCommandAdapter} from './sales-adjustment-command.adapter';
@Injectable()
export class SalesAdjustmentCommandService {
 constructor(private readonly db:SupabaseService,private readonly config:ConfigService,private readonly check:SalesAdjustmentCheckAdapter,private readonly adapter:SalesAdjustmentCommandAdapter){}
 private async rpc(actor:string,action:string,body:any):Promise<any>{
  if(this.config.get('SALES_ADJUSTMENT_COMMANDS_ENABLED')!=='true')throw new ServiceUnavailableException('Comandos desligados.');
  let r:any;try{r=await this.db.getClient().rpc('platform_sales_adjustment_command_action',{p_actor:actor,p_action:action,p_body:body});}catch{throw new ServiceUnavailableException('Resultado pendente; confira o histórico.');}
  if(r.error){if(r.error.code==='42501')throw new ForbiddenException();if(r.error.code==='P3720')throw new NotFoundException();if(['P3721','23505'].includes(r.error.code))throw new ConflictException('Versão, fonte ou reserva divergente; confira o histórico.');if(['22023','22P02','23514'].includes(r.error.code))throw new BadRequestException();throw new ServiceUnavailableException('Comando indisponível; não repita envio externo.');}return r.data;
 }
 private id(id:string){commercialInput({id},['id'],['id']);}
 private input(body:unknown,fields:string[],ids:string[]){const b=commercialInput(body,fields,ids);if(typeof b.justification!=='string'||b.justification.trim().length<20||b.justification.length>500)throw new BadRequestException();if(fields.includes('expectedVersion')&&(!Number.isInteger(b.expectedVersion)||Number(b.expectedVersion)<1||Number(b.expectedVersion)>999999))throw new BadRequestException();return b;}
 async read(actor:string,id:string,q:Record<string,unknown>){this.id(id);if(Object.entries(q).some(([k,v])=>k!=='page'||typeof v!=='string')||!/^\d{1,4}$/.test(String(q.page??'0'))||Number(q.page??0)>1000)throw new BadRequestException();return {...await this.rpc(actor,'read',{requestId:id,page:Number(q.page??0)}),externalCallsEnabled:this.config.get('SALES_ADJUSTMENT_COMMAND_CALLS_ENABLED')==='true'};}
 prepare(actor:string,id:string,body:unknown){this.id(id);const b=this.input(body,['id','operationId','expectedVersion','checkId','justification'],['id','operationId','checkId']);return this.rpc(actor,'prepare',{...b,requestId:id});}
 transition(actor:string,id:string,action:string,body:unknown){this.id(id);if(!['authorize','withdraw'].includes(action))throw new BadRequestException();const b=this.input(body,['operationId','expectedVersion','justification',...(action==='authorize'?['impactsAccepted']:[])],['operationId']);if(action==='authorize'&&b.impactsAccepted!==true)throw new BadRequestException();return this.rpc(actor,action,{...b,id});}
 private external(){if(this.config.get('SALES_ADJUSTMENT_COMMAND_CALLS_ENABLED')!=='true')throw new ServiceUnavailableException('Chamadas externas desligadas.');}
 async execute(actor:string,id:string,body:unknown){
  this.id(id);const b=this.input(body,['operationId','expectedVersion','justification'],['operationId']);this.external();
  const claim=await this.rpc(actor,'claim',{...b,id});if(!claim.execute)return claim;
  let evidence:any=null,diagnostic:string|undefined;
  try{evidence=await this.check.check(claim.source,claim.parameters,'COMMAND');}catch(error){diagnostic=queryDiagnostic(error);}
  // Persist permission/source revalidation and the irreversible dispatch boundary BEFORE send.
  const dispatch=await this.rpc(actor,'dispatch',{id,operationId:crypto.randomUUID(),expectedVersion:claim.version,justification:b.justification,evidence,...(diagnostic?{diagnostic}:{})});
  if(!dispatch.execute)return dispatch;
  let receipt:any=null;diagnostic=undefined;
  try{receipt=await this.adapter.send(claim.source,claim.parameters,claim.baseline);}catch(error){diagnostic=queryDiagnostic(error);}
  // If this write fails, DISPATCHED remains reserved. Never send again to repair persistence.
  return this.rpc(actor,'finish',{id,operationId:crypto.randomUUID(),expectedVersion:dispatch.version,justification:b.justification,evidence:receipt,...(diagnostic?{diagnostic}:{})});
 }
 async recover(actor:string,id:string,body:unknown){
  this.id(id);const b=this.input(body,['operationId','expectedVersion','justification'],['operationId']);this.external();
  const context=await this.rpc(actor,'recover',{id,operationId:b.operationId,justification:b.justification});
  let evidence:any=null,diagnostic:string|undefined;
  try{evidence=await this.adapter.recover(context);}catch(error){diagnostic=queryDiagnostic(error);}
  return this.rpc(actor,'recover_finish',{...b,id,evidence,...(diagnostic?{diagnostic}:{})});
 }
}
