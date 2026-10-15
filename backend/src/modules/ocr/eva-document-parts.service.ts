import {BadRequestException,ConflictException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
import {digest,exact,hash,justification,uuid} from './eva-extraction.model';
import {PartManifest,PARTS_LIMITS,validPrepare} from './eva-document-parts.model';
import {splitOfficialPdf} from './eva-document-parts.splitter';
import {OriginalFile} from './eva-official-document.model';
@Injectable()
export class EvaDocumentPartsService{
 private splitting=false;
 constructor(private db:SupabaseService,private config:ConfigService){}
 private async rpc(actor:string,action:string,id:string|null,body:unknown){
  if(this.config.get('EVA_DOCUMENT_PARTS_ENABLED')!=='true')throw new ServiceUnavailableException('Preparação de documentos longos desligada; aguardando homologação.');
  let r:any;try{r=await this.db.getClient().rpc('eva_document_parts_action',{p_actor:actor,p_action:action,p_set:id,p_body:body});}catch{throw new ServiceUnavailableException('Resultado não confirmado. Reconfira o histórico antes de repetir.');}
  if(r.error){if(r.error.code==='42501')throw new ForbiddenException('Exige Owner ativo e conferência independente.');if(r.error.code==='23505')throw new ConflictException('Origem, revisão ou evidências alteradas. Reconfira o histórico.');if(['22023','22P02','23514','22003'].includes(r.error.code))throw new BadRequestException('Manifesto, cobertura ou evidências inválidas.');throw new ServiceUnavailableException('Resultado não confirmado. Reconfira o histórico antes de repetir.');}return r.data;
 }
 list(actor:string,q:Record<string,unknown>){
  if(Object.keys(q).some(k=>!['page','search','state'].includes(k))||Object.values(q).some(v=>typeof v!=='string')||!/^\d{1,4}$/.test(String(q.page??0))||Number(q.page??0)>1000||String(q.search??'').length>100||!['','DRAFT','REVIEWED_PRIVATE','QUARANTINED'].includes(String(q.state??'')))throw new BadRequestException('Filtros inválidos.');
  return this.rpc(actor,'list',null,{page:Number(q.page??0),search:q.search??'',state:q.state??''});
 }
 detail(actor:string,id:string,q:Record<string,unknown>={}){if(!uuid(id)||Object.keys(q).some(k=>k!=='page')||Object.values(q).some(v=>typeof v!=='string')||!/^\d{1,4}$/.test(String(q.page??0))||Number(q.page??0)>1000)throw new BadRequestException('Consulta inválida.');return this.rpc(actor,'detail',id,{page:Number(q.page??0)});}
 private file(f:OriginalFile){if(!f||!Buffer.isBuffer(f.buffer)||f.buffer.length!==f.size||f.size<20||f.size>PARTS_LIMITS.bytes||f.mimetype!=='application/pdf'||!f.buffer.subarray(0,10).toString('ascii').startsWith('%PDF-'))throw new BadRequestException('Selecione o PDF original, até 25 MiB.');return f.buffer;}
 private async split(bytes:Buffer){
  if(this.splitting)throw new ConflictException('Existe uma preparação em andamento neste processo. Aguarde e confira o histórico.');
  this.splitting=true;try{return await splitOfficialPdf(bytes);}catch{throw new BadRequestException('PDF não processado: confira limites, integridade e conteúdo interativo. Nenhuma cobertura foi presumida.');}finally{this.splitting=false;}
 }
 async prepare(actor:string,b:unknown,f:OriginalFile){
  if(!validPrepare(b))throw new BadRequestException('Confira o original preservado e a justificativa.');
  const reference=await this.rpc(actor,'original',null,b);const bytes=this.file(f);
  if(bytes.length!==reference.size||digest(bytes)!==reference.fileHash)throw new ConflictException('O PDF difere do original preservado.');
  const output=await this.split(bytes);
  // The transactional commit rechecks the Owner and original after local processing.
  return this.rpc(actor,'prepare',null,{...b,manifest:output.manifest});
 }
 async download(actor:string,id:string,ordinal:string,f:OriginalFile){
  if(!uuid(id)||!/^\d{1,2}$/.test(ordinal)||Number(ordinal)<1||Number(ordinal)>25)throw new BadRequestException('Parte inválida.');
  const proof=await this.rpc(actor,'download',id,{}),bytes=this.file(f);
  if(digest(bytes)!==proof.originalFileHash)throw new ConflictException('Original divergente.');
  const output=await this.split(bytes);if(JSON.stringify(output.manifest)!==JSON.stringify(proof.manifest)){
   // JSONB object key ordering is not the original serialization order.
   const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
   if(JSON.stringify(canonical(output.manifest))!==JSON.stringify(canonical(proof.manifest)))throw new ConflictException('Parte não reproduz o manifesto preservado.');
  }
  const file=output.files[Number(ordinal)-1];if(!file)throw new BadRequestException('Parte ausente.');
  await this.rpc(actor,'download',id,{});return file;
 }
 command(actor:string,id:string,action:string,b:unknown){
  const fields=['requestId','expectedSetId','justification',...(action==='link'?['ordinal','jobId','expectedVersionId','expectedContentHash']:[])];
  if(!uuid(id)||!['link','review','quarantine'].includes(action)||!exact(b,fields)||!uuid(b.requestId)||!uuid(b.expectedSetId)||!justification(b.justification))throw new BadRequestException('Decisão inválida.');
  if(action==='link'&&(!Number.isInteger(b.ordinal)||b.ordinal<1||b.ordinal>25||!uuid(b.jobId)||!uuid(b.expectedVersionId)||!hash(b.expectedContentHash)))throw new BadRequestException('Vínculo inválido.');
  return this.rpc(actor,action,id,b);
 }
}
