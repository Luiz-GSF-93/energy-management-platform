import {ConfigService} from '@nestjs/config';
import {BadRequestException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {PlatformCostsService} from '../platform-costs/platform-costs.service';
export const uuid=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const fields:Record<string,string[]>={team:['search','profile','active'],audit:['search','actor','target','from','to'],support:['search','status','organization','priority','assignee','from','to'],finance:['search','status','organization','month'],support_history:[],finance_history:[],sales_detail:[],sales_history:[],sales_consolidated_detail:[],costs:['search','organization','month']};
export function administrationQuery(kind:string,q:Record<string,unknown>){
 const allowed=fields[kind];if(!allowed||Object.entries(q).some(([k,v])=>!['page',...allowed].includes(k)||typeof v!=='string'||v.length>150))throw new BadRequestException('Filtros inválidos.');
 const page=String(q.page??'0');if(!/^\d{1,4}$/.test(page)||Number(page)>1000)throw new BadRequestException('Página inválida.');
 const filter:Record<string,string>={};for(const key of allowed)if(q[key])filter[key]=String(q[key]).trim();
 for(const key of ['actor','target','assignee'])if(filter[key]&&!uuid.test(filter[key]))throw new BadRequestException('Identificador inválido.');
 for(const key of ['from','to'])if(filter[key]&&(!/^\d{4}-\d{2}-\d{2}$/.test(filter[key])||!Number.isFinite(Date.parse(filter[key]+'T00:00:00Z'))||new Date(filter[key]+'T00:00:00Z').toISOString().slice(0,10)!==filter[key]))throw new BadRequestException('Data inválida.');
 if(filter.from&&filter.to&&filter.from>filter.to)throw new BadRequestException('Período inválido.');
 if(filter.month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(filter.month))throw new BadRequestException('Competência inválida.');
 for(const [key,values] of Object.entries({profile:['OWNER','ADMINISTRATOR','FINANCE','SUPPORT'],active:['true','false'],priority:['LOW','NORMAL','HIGH'],status:kind==='finance'?['PROPOSED','CONFIRMED','REJECTED']:['OPEN','IN_PROGRESS','WAITING','RESOLVED','CLOSED']}))if(filter[key]&&!values.includes(filter[key]))throw new BadRequestException('Seleção inválida.');
 if(kind==='costs')filter.month??=new Date().toISOString().slice(0,7);
 return {page:Number(page),filter};
}
@Injectable()
export class PlatformAdministrationService{
 constructor(private readonly db:SupabaseService,private readonly costs:PlatformCostsService,private readonly config?:ConfigService){}
 async read(actor:string,kind:string,q:Record<string,unknown>,id?:string){
  if(kind.startsWith('sales_')&&(this.config?.get('SALES_ASAAS_FINANCE_READ_ENABLED')!=='true'||this.config?.get('SALES_ASAAS_SANDBOX_ENABLED')!=='true'||kind==='sales_consolidated_detail'&&this.config?.get('SALES_ASAAS_CONSOLIDATED_ENABLED')!=='true'))throw new ServiceUnavailableException('Acompanhamento financeiro sandbox desligado.');
  const {page,filter}=administrationQuery(kind,q);if(id!==undefined&&!uuid.test(id))throw new BadRequestException('Identificador inválido.');
  let result:any;try{result=await this.db.getClient().rpc('platform_admin_read_6b',{p_actor:actor,p_kind:kind,p_id:id??null,p_page:page,p_filter:filter});}catch{throw new ServiceUnavailableException('Consulta administrativa indisponível.');}
  if(result.error?.code==='42501')throw new ForbiddenException('Perfil ou atribuição não autoriza esta consulta.');
  if(['22023','22007','22008','22P02'].includes(result.error?.code))throw new BadRequestException('Filtros inválidos.');
  if(result.error||!result.data)throw new ServiceUnavailableException('Consulta administrativa indisponível.');
  return kind==='costs'?this.costs.project(result.data,filter.month):result.data;
 }
}
