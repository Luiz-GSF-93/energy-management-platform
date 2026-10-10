import {BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
const uuid=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export function commercialInput(body:unknown,fields:string[],ids:string[],integers:string[]=[]):Record<string,any>{
 if(!body||typeof body!=='object'||Array.isArray(body))throw new BadRequestException('Dados inválidos.');
 const value=body as Record<string,any>;
 if(Object.keys(value).length!==fields.length||Object.keys(value).some(k=>!fields.includes(k))||ids.some(k=>typeof value[k]!=='string'||!uuid.test(value[k]))||integers.some(k=>!Number.isSafeInteger(value[k])||value[k]<0||value[k]>1000000000)||JSON.stringify(value).length>16000)throw new BadRequestException('Dados inválidos.');
 return value;
}
@Injectable()
export class SalesCommercialService{
 constructor(private readonly db:SupabaseService){}
 async rpc(name:string,args:Record<string,unknown>){
  const {data,error}=await this.db.getClient().rpc(name,args);
  if(error){
   if(error.code==='42501')throw new ForbiddenException('Acesso exclusivo a Owner ativo.');
   if(error.code==='P3611'||error.code==='23505')throw new ConflictException('Versão ou solicitação alterada. Atualize antes de continuar.');
   if(error.code==='P3610')throw new NotFoundException('Plano, política ou solicitação indisponível.');
   if(['22023','22007','22008','22P02','23514','22003'].includes(error.code))throw new BadRequestException('Condições comerciais inválidas ou incompatíveis com o cadastro.');
   throw new ServiceUnavailableException('Ambiente comercial indisponível. Nenhuma licença ou cobrança foi criada.');
  }
  return data;
 }
 read(actor:string,receipt?:string){if(receipt!==undefined&&!uuid.test(receipt))throw new BadRequestException('Protocolo inválido.');return this.rpc('read_platform_sales_commercial',{p_actor:actor,p_receipt:receipt??null});}
 policy(actor:string,body:unknown){const b=commercialInput(body,['requestId','planId','expectedVersion','planVersion','definition'],['requestId','planId'],['expectedVersion','planVersion']);return this.rpc('save_platform_sales_policy',{p_actor:actor,p_request:b.requestId,p_plan:b.planId,p_expected:b.expectedVersion,p_plan_version:b.planVersion,p_definition:b.definition});}
 proposal(actor:string,body:unknown){const b=commercialInput(body,['id','receipt','planId','policyVersion','cycle','extras','justification'],['id','receipt','planId'],['policyVersion']);if(!['MONTHLY','ANNUAL'].includes(b.cycle)||!Array.isArray(b.extras)||b.extras.length>20||b.extras.some((x:unknown)=>typeof x!=='string')||typeof b.justification!=='string')throw new BadRequestException('Proposta inválida.');return this.rpc('create_platform_sales_proposal',{p_actor:actor,p_id:b.id,p_receipt:b.receipt,p_plan:b.planId,p_policy_version:b.policyVersion,p_cycle:b.cycle,p_extras:b.extras,p_justification:b.justification});}
 review(actor:string,body:unknown){const b=commercialInput(body,['requestId','id','expectedVersion','status','justification'],['requestId','id'],['expectedVersion']);if(!['CHECKED','APPROVED_INTERNAL'].includes(b.status)||typeof b.justification!=='string')throw new BadRequestException('Revisão inválida.');return this.rpc('transition_platform_sales_proposal',{p_actor:actor,p_request:b.requestId,p_id:b.id,p_expected:b.expectedVersion,p_status:b.status,p_justification:b.justification});}
}
