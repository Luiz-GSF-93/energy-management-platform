import {BadRequestException,ConflictException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
import {OFFICIAL_SOURCE_FAMILIES,OFFICIAL_SOURCE_STATES,SOURCE_UUID,officialSourceHash,officialSourceMetadata} from './eva-official-source.model';
export type SourceAction='create'|'update'|'confirm'|'suspend'|'resume';
@Injectable()
export class EvaOfficialSourceService {
 constructor(private db:SupabaseService,private config:ConfigService){}
 private async action(actor:string,action:string,sourceId:string|null,body:unknown){
  if(this.config.get('EVA_OFFICIAL_SOURCE_REGISTRY_ENABLED')!=='true')throw new ServiceUnavailableException('Cadastro de fontes oficiais desligado; aguardando homologação.');
  let r:any;try{r=await this.db.getClient().rpc('eva_official_source_action',{p_actor:actor,p_action:action,p_source_id:sourceId,p_body:body})}catch{throw new ServiceUnavailableException('Cadastro de fontes indisponível.')}
  if(r.error){if(r.error.code==='42501')throw new ForbiddenException('Gestão exclusiva do Owner ativo.');if(r.error.code==='23505')throw new ConflictException('Estado alterado. Reconfira a versão antes de continuar.');if(['22023','22P02','23514'].includes(r.error.code))throw new BadRequestException('Dados da fonte inválidos.');throw new ServiceUnavailableException('Cadastro de fontes indisponível.');}return r.data;
 }
 async list(actor:string,q:Record<string,unknown>={}){
  const allowed=['page','search','authority','family','state'];
  if(Object.keys(q).some(k=>!allowed.includes(k))||Object.values(q).some(v=>typeof v!=='string')||!/^\d{1,4}$/.test(String(q.page??'0'))||Number(q.page??0)>1000||String(q.search??'').length>100||q.state&&!OFFICIAL_SOURCE_STATES.includes(q.state as any)||q.authority&&!Object.prototype.hasOwnProperty.call(OFFICIAL_SOURCE_FAMILIES,q.authority as string)||q.family&&!Object.values(OFFICIAL_SOURCE_FAMILIES).flat().includes(q.family as any))throw new BadRequestException('Filtros inválidos.');
  return this.action(actor,'list',null,{page:Number(q.page??0),search:q.search??'',authority:q.authority??'',family:q.family??'',state:q.state??''});
 }
 async detail(actor:string,id:string,q:Record<string,unknown>={}){
  if(!SOURCE_UUID.test(id)||Object.keys(q).some(k=>k!=='page')||!/^\d{1,4}$/.test(String(q.page??'0'))||Number(q.page??0)>1000)throw new BadRequestException('Fonte ou página inválida.');
  return this.action(actor,'detail',id,{page:Number(q.page??0)});
 }
 async command(actor:string,id:string|null,action:SourceAction,value:unknown){
  const b=value as Record<string,unknown>,withMetadata=action==='create'||action==='update';
  const keys=['requestId','expectedEventId','expectedRevisionHash','justification',...(withMetadata?['metadata']:[])];
  if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).length!==keys.length||Object.keys(b).some(k=>!keys.includes(k))||typeof b.requestId!=='string'||!SOURCE_UUID.test(b.requestId)||typeof b.justification!=='string'||b.justification.trim().length<20||b.justification.length>1000||/[\x00-\x1f\x7f]/.test(b.justification))throw new BadRequestException('Informe versão e justificativa válidas.');
  if(action==='create'?(id!==null||b.expectedEventId!==null||b.expectedRevisionHash!==null):(!id||!SOURCE_UUID.test(id)||typeof b.expectedEventId!=='string'||!SOURCE_UUID.test(b.expectedEventId)||typeof b.expectedRevisionHash!=='string'||!/^[a-f0-9]{64}$/.test(b.expectedRevisionHash)))throw new BadRequestException('Referência da versão inválida.');
  const metadata=withMetadata?officialSourceMetadata(b.metadata):null;
  if(withMetadata&&!metadata)throw new BadRequestException('Metadados ou origem declarada inválidos.');
  return this.action(actor,action,id,{...b,...(metadata?{metadata,metadataHash:officialSourceHash(metadata)}:{})});
 }
}
