import {ConflictException,ForbiddenException,HttpException,Injectable,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {createHash,createHmac} from 'crypto';
import {SupabaseService} from '../../services/supabase.service';
import {normalizeLead} from './sales-intake.input';
@Injectable()
export class SalesIntakeService{
 constructor(private readonly db:SupabaseService){}
 async submit(body:unknown,origin:string|undefined,ip:string|undefined){
  if(process.env.SALES_INTAKE_ENABLED!=='true')throw new NotFoundException();
  if(origin!==(process.env.SALES_INTAKE_ORIGIN||'https://www.expertenergy.com.br'))throw new ForbiddenException('Origem não autorizada.');
  const secret=process.env.SALES_INTAKE_HASH_SECRET;if(!secret||secret.length<32||!ip)throw new ServiceUnavailableException('Recebimento temporariamente indisponível.');
  const lead=normalizeLead(body);
  const {data,error}=await this.db.getClient().rpc('submit_platform_sales_lead',{p_receipt:lead.requestId,p_payload:lead,p_hash:createHash('sha256').update(JSON.stringify(lead)).digest('hex'),p_requester:createHmac('sha256',secret).update(ip).digest('hex')});
  if(error?.code==='P3601')throw new ConflictException('Formulário alterado. Inicie um novo envio.');
  if(error?.code==='P3602')throw new HttpException('Limite de solicitações atingido. Tente mais tarde.',429);
  if(error||data?.receipt!==lead.requestId)throw new ServiceUnavailableException('Recebimento não confirmado. Tente novamente.');
  return {receipt:lead.requestId,status:'RECEIVED',message:'Solicitação recebida para avaliação comercial. Nenhuma contratação foi realizada.'};
 }
 async list(actor:string,page:number,search:string){
  const {data,error}=await this.db.getClient().rpc('read_platform_sales_leads',{p_actor:actor,p_page:page,p_search:search});
  if(error?.code==='42501')throw new ForbiddenException('Acesso exclusivo a Owner ativo.');
  if(error||!data)throw new ServiceUnavailableException('Não foi possível consultar as solicitações.');return data;
 }
}
