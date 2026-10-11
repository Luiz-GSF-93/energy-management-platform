import {BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
import {commercialInput} from './sales-commercial.service';
@Injectable()
export class SalesRecurrenceService {
 constructor(private readonly db:SupabaseService,private readonly config:ConfigService){}
 private async rpc(actor:string,action:string,body:unknown):Promise<any>{
  if(this.config.get('SALES_RECURRENCE_PREPARATION_ENABLED')!=='true')throw new ServiceUnavailableException('Preparação de recorrência desligada.');
  let r:any;try{r=await this.db.getClient().rpc('platform_sales_recurrence_action',{p_actor:actor,p_action:action,p_body:body});}catch{throw new ServiceUnavailableException('Recorrência privada indisponível.');}
  if(r.error){const c=r.error.code;if(c==='42501')throw new ForbiddenException('Perfil sem autorização.');if(['P3610','P3660'].includes(c))throw new NotFoundException('Fonte não localizada.');if(['P3611','P3661','23505'].includes(c))throw new ConflictException('Versão, fonte ou ciclo divergente.');if(['22023','22P02','22007','22008','23514','22003'].includes(c))throw new BadRequestException('Dados ou fonte aprovados inválidos.');throw new ServiceUnavailableException('Recorrência privada indisponível.');}
  return r.data;
 }
 list(actor:string,q:Record<string,unknown>){
  if(Object.entries(q).some(([k,v])=>!['page','search','state'].includes(k)||typeof v!=='string')||!/^\d{1,4}$/.test(String(q.page??'0'))||Number(q.page??0)>1000||String(q.search??'').length>100||!['','PREPARED','CHECKED','APPROVED_INTERNAL'].includes(String(q.state??'')))throw new BadRequestException('Filtros inválidos.');
  return this.rpc(actor,'list',{page:Number(q.page??0),search:q.search??'',state:q.state??''});
 }
 read(actor:string,id:string){commercialInput({id},['id'],['id']);return this.rpc(actor,'read',{id});}
 prepare(actor:string,body:unknown){
  const b=commercialInput(body,['id','intentId','nextDueDate','justification'],['id','intentId']);
  if(typeof b.nextDueDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.nextDueDate)||typeof b.justification!=='string'||b.justification.trim().length<20||b.justification.length>500)throw new BadRequestException('Data e justificativa exigidas.');
  return this.rpc(actor,'prepare',b);
 }
 review(actor:string,id:string,body:unknown){
  commercialInput({id},['id'],['id']);const b=commercialInput(body,['requestId','expectedVersion','status','justification'],['requestId'],['expectedVersion']);
  if(b.expectedVersion<1||!['CHECKED','APPROVED_INTERNAL'].includes(b.status)||typeof b.justification!=='string'||b.justification.trim().length<20||b.justification.length>500)throw new BadRequestException('Conferência inválida.');
  return this.rpc(actor,'review',{id,...b});
 }
}
