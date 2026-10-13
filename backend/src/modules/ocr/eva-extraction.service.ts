import {BadRequestException,ConflictException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
import {digest,exact,hash,justification,uuid,EXTRACTION_STATES} from './eva-extraction.model';
import {EvaExtractionBlobReader} from './eva-extraction-blob.reader';
@Injectable()
export class EvaExtractionService{
 constructor(private db:SupabaseService,private config:ConfigService,private reader:EvaExtractionBlobReader){}
 private async rpc(actor:string,action:string,id:string|null,b:unknown){
  if(this.config.get('EVA_OFFICIAL_EXTRACTION_ENABLED')!=='true')throw new ServiceUnavailableException('Extração e curadoria desligadas; aguardando homologação.');
  let r:any;try{r=await this.db.getClient().rpc('eva_official_extraction_action',{p_actor:actor,p_action:action,p_job:id,p_body:b})}catch{throw new ServiceUnavailableException('Conferência indisponível. Preserve a tentativa.');}
  if(r.error){if(r.error.code==='42501')throw new ForbiddenException('Gestão exclusiva do Owner ativo.');if(r.error.code==='23505')throw new ConflictException('Origem, versão ou tentativa alterada. Reconfira antes de registrar.');if(['22023','22P02','23514','22007','22008'].includes(r.error.code))throw new BadRequestException('Dados ou evidências de curadoria incompletos.');throw new ServiceUnavailableException('Extração indisponível. Reconfira antes de repetir.');}return r.data;
 }
 list(actor:string,q:Record<string,unknown>){if(Object.keys(q).some(k=>!['page','search','state'].includes(k))||Object.values(q).some(v=>typeof v!=='string')||!/^\d{1,4}$/.test(String(q.page??0))||Number(q.page??0)>1000||String(q.search??'').length>100||q.state&&!EXTRACTION_STATES.includes(String(q.state)))throw new BadRequestException('Filtros inválidos.');return this.rpc(actor,'list',null,{page:Number(q.page??0),search:q.search??'',state:q.state??''});}
 detail(actor:string,id:string,q:Record<string,unknown>={}){if(!uuid(id)||Object.keys(q).some(k=>!['page','sectionPage'].includes(k))||Object.values(q).some(v=>typeof v!=='string')||['page','sectionPage'].some(k=>!/^\d{1,4}$/.test(String(q[k]??0))||Number(q[k]??0)>1000))throw new BadRequestException('Consulta inválida.');return this.rpc(actor,'detail',id,{page:Number(q.page??0),sectionPage:Number(q.sectionPage??0)});}
 prepare(actor:string,b:unknown){if(!exact(b,['requestId','justification','documentId','expectedEventId','expectedRevisionHash','operationId','testOnly'])||!uuid(b.requestId)||!uuid(b.documentId)||!uuid(b.expectedEventId)||!uuid(b.operationId)||!hash(b.expectedRevisionHash)||!justification(b.justification)||typeof b.testOnly!=='boolean')throw new BadRequestException('Confira original preservado e versão.');return this.rpc(actor,'prepare',null,b);}
 async command(actor:string,id:string,action:string,b:unknown){
  const common=['requestId','justification','expectedCurationEventId','expectedVersionId','expectedContentHash'];
  const processingAction=['withdraw','retry'].includes(action);
  const extra=action==='correct'?['patches','metadata']:action==='review'?['acknowledgedPages']:processingAction?['expectedProcessingEventId']:[];
  const keys=processingAction?['requestId','justification',...extra]:[...common,...extra];
  if(!uuid(id)||!['correct','review','quarantine','withdraw','retry'].includes(action)||!exact(b,keys)||!uuid(b.requestId)||!justification(b.justification))throw new BadRequestException('Comando inválido.');
  if(processingAction){if(!uuid(b.expectedProcessingEventId))throw new BadRequestException('Reserva inválida.');return this.rpc(actor,action,id,b);}
  if(!uuid(b.expectedCurationEventId)||!uuid(b.expectedVersionId)||!hash(b.expectedContentHash))throw new BadRequestException('Versão inválida.');
  if(action==='review'&&(!Array.isArray(b.acknowledgedPages)||b.acknowledgedPages.length>100||b.acknowledgedPages.some((n:unknown)=>!Number.isInteger(n)||Number(n)<1||Number(n)>100)))throw new BadRequestException('Confira todas as páginas.');
  if(action==='correct'){
   if(!Array.isArray(b.patches)||b.patches.length>10||Buffer.byteLength(JSON.stringify(b.patches))>60000||!exact(b.metadata,['publishedOn','validFrom','validTo','topic','references']))throw new BadRequestException('Correção inválida.');
   for(const p of b.patches){if(!exact(p,['id','text','heading','resolvedIssues'])||!uuid(p.id)||typeof p.text!=='string'||!p.text.trim()||Buffer.byteLength(p.text)>16000||typeof p.heading!=='string'||p.heading.length>200||!Array.isArray(p.resolvedIssues)||p.resolvedIssues.some((x:unknown)=>!['LAYOUT_REVIEW','IMAGE_PRESENT'].includes(String(x))))throw new BadRequestException('Trecho inválido.');}
   const patches=b.patches.map((p:any)=>({...p,hash:digest(p.text)}));
   const body={...b,patches,contentHash:digest(JSON.stringify({parent:b.expectedContentHash,metadata:b.metadata,patches}))};return this.rpc(actor,action,id,body);
  }
  return this.rpc(actor,action,id,b);
 }
 async original(actor:string,id:string){if(!uuid(id))throw new BadRequestException('Tarefa inválida.');const reference=await this.rpc(actor,'original',id,{});const bytes=await this.reader.read(reference);await this.rpc(actor,'original',id,{});return bytes;}
 async metrics(actor:string,q:Record<string,unknown>){
  if(this.config.get('EVA_OFFICIAL_EXTRACTION_ENABLED')!=='true')throw new ServiceUnavailableException('Métricas da extração desligadas; aguardando homologação.');
  if(!exact(q,['month'])||typeof q.month!=='string'||!/^(20|21)\d{2}-(0[1-9]|1[0-2])$/.test(q.month))throw new BadRequestException('Competência inválida.');
  let r:any;try{r=await this.db.getClient().rpc('eva_official_extraction_metrics',{p_actor:actor,p_month:q.month})}catch{throw new ServiceUnavailableException('Métricas indisponíveis.');}
  if(r.error){if(r.error.code==='42501')throw new ForbiddenException('Consulta restrita ao Owner e Financeiro autorizado.');throw new ServiceUnavailableException('Métricas indisponíveis.');}return r.data;
 }
}
