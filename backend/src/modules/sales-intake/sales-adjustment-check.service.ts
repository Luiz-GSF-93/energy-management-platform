import {BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
import {commercialInput} from './sales-commercial.service';
import {SalesAdjustmentCheckAdapter,queryDiagnostic} from './sales-adjustment-check.adapter';
@Injectable()
export class SalesAdjustmentCheckService {
 constructor(private readonly db:SupabaseService,private readonly config:ConfigService,private readonly adapter:SalesAdjustmentCheckAdapter){}
 private async rpc(actor:string,action:string,body:any):Promise<any>{
  if(this.config.get('SALES_ADJUSTMENT_CHECKS_ENABLED')!=='true')throw new ServiceUnavailableException('Pré-validação desligada.');
  let r:any;try{r=await this.db.getClient().rpc('platform_sales_adjustment_check_action',{p_actor:actor,p_action:action,p_body:body});}catch{throw new ServiceUnavailableException('Consulta indisponível; confira o histórico.');}
  if(r.error){if(r.error.code==='42501')throw new ForbiddenException();if(r.error.code==='P3710')throw new NotFoundException();if(['P3711','23505'].includes(r.error.code))throw new ConflictException('Fonte ou versão mudou; confira o histórico.');if(['22023','22P02','23514'].includes(r.error.code))throw new BadRequestException();throw new ServiceUnavailableException('Pré-validação indisponível.');}return r.data;
 }
 private id(id:string){commercialInput({id},['id'],['id']);}
 async read(actor:string,id:string,q:Record<string,unknown>){this.id(id);if(Object.entries(q).some(([k,v])=>k!=='page'||typeof v!=='string')||!/^\d{1,4}$/.test(String(q.page??'0'))||Number(q.page??0)>1000)throw new BadRequestException();return {...await this.rpc(actor,'read',{requestId:id,page:Number(q.page??0)}),externalCallsEnabled:this.config.get('SALES_ADJUSTMENT_CHECK_CALLS_ENABLED')==='true'};}
 prepare(actor:string,id:string,body:unknown){this.id(id);const b=commercialInput(body,['id','expectedVersion','justification'],['id']);if(!Number.isInteger(b.expectedVersion)||Number(b.expectedVersion)<1||Number(b.expectedVersion)>999999||typeof b.justification!=='string'||b.justification.trim().length<20||b.justification.length>500)throw new BadRequestException();return this.rpc(actor,'prepare',{...b,requestId:id});}
 async check(actor:string,id:string,body:unknown){this.id(id);const b=commercialInput(body,['commandId'],['commandId']);if(this.config.get('SALES_ADJUSTMENT_CHECK_CALLS_ENABLED')!=='true')throw new ServiceUnavailableException('Consultas externas desligadas.');const claim=await this.rpc(actor,'claim',{id,...b});if(!claim.execute)return claim;
  let evidence,diagnostic;try{evidence=await this.adapter.check(claim.source,claim.parameters);}catch(error){evidence=null;diagnostic=queryDiagnostic(error);}
  return this.rpc(actor,'finish',{id,...b,evidence,...(diagnostic?{diagnostic}:{})});
 }
}
