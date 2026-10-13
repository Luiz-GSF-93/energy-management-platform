import {BadRequestException,ConflictException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {catalogCommand,catalogFilter,catalogMonth,catalogPage,catalogUuid,COST_SERVICE_PRESETS} from './service-catalog.model';
@Injectable()
export class CostServiceCatalogService{
 constructor(private db:SupabaseService){}
 private enabled(){if(process.env.PLATFORM_COST_SERVICE_CATALOG_ENABLED!=='true')throw new ServiceUnavailableException('Catálogo de serviços desligado; aguardando homologação.');}
 private async rpc(actor:string,action:string,id:string|null,body:object){const{data,error}=await this.db.getClient().rpc('platform_cost_service_action',{p_actor:actor,p_action:action,p_service:id,p_body:body});if(error?.code==='42501')throw new ForbiddenException('Consulta exclusiva do Owner e Financeiro; cadastro exclusivo do Owner.');if(error?.code==='23505')throw new ConflictException('Versão, código ou lançamento já vinculado. Reconfira antes de registrar.');if(error?.code==='22023'||error?.code==='23514')throw new BadRequestException('Confira metadados, origem e seleção única de lançamento por competência.');if(error||!data)throw new ServiceUnavailableException('Resultado do catálogo não confirmado. Reconfira antes de repetir.');return data;}
 async list(actor:string,q:Record<string,unknown>){this.enabled();return this.rpc(actor,'list',null,catalogFilter(q));}
 async detail(actor:string,id:string,q:Record<string,unknown>){this.enabled();if(Object.keys(q).some(k=>!['page','month'].includes(k)))throw new BadRequestException('Filtros inválidos.');return this.rpc(actor,'detail',catalogUuid(id),{page:catalogPage(q.page),month:catalogMonth(q.month)});}
 async save(actor:string,id:string|null,b:unknown){this.enabled();return this.rpc(actor,id?'revise':'create',id?catalogUuid(id):null,catalogCommand(b));}
 async presets(actor:string,month:string){this.enabled();await this.rpc(actor,'list',null,catalogFilter({month}));return{rows:COST_SERVICE_PRESETS,notice:'Modelos não cadastrados, sem contratação ou valor presumido. Owner deve conferir cada recurso.'};}
}
