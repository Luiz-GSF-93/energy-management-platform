import {BadRequestException,ForbiddenException,Injectable,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
export const SALES_FINANCE_READ='c767190a-5ec0-4d89-8675-688415e967b1';
export const SALES_OWNER='82e7fc71-479a-4dd6-8b22-4fba6eaa6841';
@Injectable()
export class SalesFinanceService {
 constructor(private readonly db:SupabaseService,private readonly config:ConfigService){}
 async read(actor:string,q:Record<string,unknown>,id?:string){
  if(this.config.get('SALES_ASAAS_FINANCE_READ_ENABLED')!=='true'||this.config.get('SALES_ASAAS_SANDBOX_ENABLED')!=='true')throw new ServiceUnavailableException('Acompanhamento financeiro sandbox desligado; aguardando homologação.');
  const date=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
  if(Object.entries(q).some(([k,v])=>!['page','search','status','from','to'].includes(k)||typeof v!=='string')||!/^\d{1,4}$/.test(String(q.page??'0'))||Number(q.page??0)>1000||String(q.search??'').length>100||!['','PENDING','OVERDUE','CONFIRMED','RECEIVED','REFUNDED','UNKNOWN'].includes(String(q.status??''))||['from','to'].some(k=>q[k]!==undefined&&!date(q[k]))||q.from&&q.to&&String(q.from)>String(q.to)||id!==undefined&&!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))throw new BadRequestException('Filtros financeiros inválidos.');
  let result:any;
  try{result=await this.db.getClient().rpc('read_platform_sales_finance',{p_actor:actor,p_page:Number(q.page??0),p_search:q.search??'',p_status:q.status??'',p_from:q.from??null,p_to:q.to??null,p_id:id??null});}catch{throw new ServiceUnavailableException('Consulta financeira indisponível.');}
  if(result.error){if(result.error.code==='42501')throw new ForbiddenException('Consulta restrita ao Owner e Financeiro autorizado.');if(result.error.code==='P3610')throw new NotFoundException('Cobrança não localizada.');if(['22023','22P02','22008'].includes(result.error.code))throw new BadRequestException('Filtros financeiros inválidos.');throw new ServiceUnavailableException('Consulta financeira indisponível.');}
  return result.data;
 }
}
