import {BadRequestException,ConflictException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
import {digest,exact,uuid,justification} from './eva-extraction.model';
import {fragmentSource,searchFilters,searchPrepare,SearchSource,SEARCH_PARSER,SEARCH_DIMENSIONS} from './eva-search.model';
@Injectable()
export class EvaSearchService{
 constructor(private db:SupabaseService,private config:ConfigService){}
 private async rpc(actor:string,action:string,id:string|null,body:unknown){
  if(this.config.get('EVA_SEARCH_PREPARATION_ENABLED')!=='true')throw new ServiceUnavailableException('Preparação Search desligada; aguardando homologação.');
  let r:any;try{r=await this.db.getClient().rpc('eva_search_action',{p_actor:actor,p_action:action,p_release:id,p_body:body});}catch{throw new ServiceUnavailableException('Preparação não confirmada; preserve a tentativa.');}
  if(r.error){if(r.error.code==='42501')throw new ForbiddenException('Operação exclusiva do Owner ativo.');if(r.error.code==='23505')throw new ConflictException('Fonte, revisão ou tentativa alterada; reconfira.');if(['22023','22P02','23514'].includes(r.error.code))throw new BadRequestException('Confira versões, fragmentos e justificativa.');throw new ServiceUnavailableException('Operação não confirmada; preserve a tentativa.');}return r.data;
 }
 list(actor:string,q:Record<string,unknown>){let filters;try{filters=searchFilters(q);}catch{throw new BadRequestException('Filtros inválidos.');}return this.rpc(actor,'list',null,filters);}
 detail(actor:string,id:string,q:Record<string,unknown>){if(!uuid(id)||Object.keys(q).some(k=>!['page'].includes(k))||!/^\d{1,4}$/.test(String(q.page??0))||Number(q.page??0)>1000)throw new BadRequestException('Consulta inválida.');return this.rpc(actor,'detail',id,{page:Number(q.page??0)});}
 async prepare(actor:string,b:unknown){
  let input;try{input=searchPrepare(b);}catch{throw new BadRequestException('Confira a revisão exata.');}
  const source:SearchSource=await this.rpc(actor,'candidate',null,{jobId:input.jobId});
  if(source.versionId!==input.expectedVersionId||source.reviewEventId!==input.expectedReviewEventId||source.contentHash!==input.expectedContentHash)throw new ConflictException('A versão conferida mudou.');
  let chunks;try{chunks=fragmentSource(source);}catch{throw new BadRequestException('Fragmentação bloqueada por integridade ou limite.');}
  const manifest={jobId:source.jobId,versionId:source.versionId,reviewEventId:source.reviewEventId,contentHash:source.contentHash,fileHash:source.fileHash,metadata:source.metadata,parser:SEARCH_PARSER,dimensions:SEARCH_DIMENSIONS,audience:'PLATFORM',scope:'OFFICIAL_PUBLIC'};
  return this.rpc(actor,'prepare',null,{...input,manifest,chunks});
 }
 command(actor:string,id:string,action:string,b:unknown){if(!uuid(id)||!['approve','withdraw'].includes(action)||!exact(b,['requestId','expectedEventId','justification'])||!uuid(b.requestId)||!uuid(b.expectedEventId)||!justification(b.justification))throw new BadRequestException('Comando inválido.');return this.rpc(actor,action,id,b);}
 async metrics(actor:string,q:Record<string,unknown>){if(this.config.get('EVA_SEARCH_PREPARATION_ENABLED')!=='true')throw new ServiceUnavailableException('Métricas Search desligadas.');if(!exact(q,['month'])||typeof q.month!=='string'||!/^(20|21)\d{2}-(0[1-9]|1[0-2])$/.test(q.month))throw new BadRequestException('Competência inválida.');const r=await this.db.getClient().rpc('eva_search_metrics',{p_actor:actor,p_month:q.month});if(r.error){if(r.error.code==='42501')throw new ForbiddenException('Consulta restrita ao Owner e Financeiro.');throw new ServiceUnavailableException('Métricas indisponíveis.');}return r.data;}
}
