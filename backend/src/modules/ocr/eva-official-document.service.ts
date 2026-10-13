import {BadRequestException,ConflictException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {randomUUID} from 'node:crypto';
import {SupabaseService} from '../../services/supabase.service';
import {SOURCE_UUID} from './eva-official-source.model';
import {documentCommand,documentMetadata,metadataHash,OriginalFile,sha256,STORAGE_STATES,validHash} from './eva-official-document.model';
import {EvaOriginalBlobConnector,BlobEvidence} from './eva-original-blob.connector';
import {validateOriginalPdf} from './eva-original-pdf.validator';
@Injectable()
export class EvaOfficialDocumentService {
 constructor(private db:SupabaseService,private config:ConfigService,private blob:EvaOriginalBlobConnector){}
 private async rpc(actor:string,action:string,id:string|null,body:unknown){
  if(this.config.get('EVA_OFFICIAL_DOCUMENTS_ENABLED')!=='true')throw new ServiceUnavailableException('Gestão de originais desligada; aguardando homologação.');
  let r:any;try{r=await this.db.getClient().rpc('eva_official_document_action',{p_actor:actor,p_action:action,p_document_id:id,p_body:body})}catch{throw new ServiceUnavailableException('Originais indisponíveis. Reconfira o estado antes de reenviar.')}
  if(r.error){if(r.error.code==='42501')throw new ForbiddenException('Gestão exclusiva do Owner ativo.');if(r.error.code==='23505')throw new ConflictException('Versão, fonte ou tentativa alterada. Reconfira o estado.');if(['22023','22P02','23514'].includes(r.error.code))throw new BadRequestException('Metadados ou referência inválidos.');throw new ServiceUnavailableException('Originais indisponíveis. Reconfira o estado antes de reenviar.')}return r.data;
 }
 async list(actor:string,q:Record<string,unknown>={}){
  if(Object.keys(q).some(k=>!['page','search','state'].includes(k))||Object.values(q).some(v=>typeof v!=='string')||!/^\d{1,4}$/.test(String(q.page??0))||Number(q.page??0)>1000||String(q.search??'').length>100||q.state&&!STORAGE_STATES.includes(q.state as any))throw new BadRequestException('Filtros inválidos.');
  return this.rpc(actor,'list',null,{page:Number(q.page??0),search:q.search??'',state:q.state??''});
 }
 async detail(actor:string,id:string,q:Record<string,unknown>={}){if(!SOURCE_UUID.test(id)||Object.keys(q).some(k=>k!=='page')||Object.values(q).some(v=>typeof v!=='string')||!/^\d{1,4}$/.test(String(q.page??0))||Number(q.page??0)>1000)throw new BadRequestException('Documento ou página inválidos.');return this.rpc(actor,'detail',id,{page:Number(q.page??0)});}
 async prepare(actor:string,id:string|null,value:unknown){
  const b=value as any,meta=documentMetadata(b?.metadata);
  if(!documentCommand(b,['sourceId','expectedSourceEventId','expectedSourceRevisionHash','metadata'])||!meta||!SOURCE_UUID.test(b.sourceId)||!SOURCE_UUID.test(b.expectedSourceEventId)||!validHash(b.expectedSourceRevisionHash)||(id===null?b.expectedEventId!==null:!SOURCE_UUID.test(id)||b.expectedEventId===null))throw new BadRequestException('Informe fonte, versão e procedência válidas.');
  return this.rpc(actor,id?'revise':'prepare',id,{...b,metadata:meta,metadataHash:metadataHash(meta)});
 }
 private command(id:string,value:unknown,extra:string[]=[]){if(!SOURCE_UUID.test(id)||!documentCommand(value,extra)||(value as any).expectedEventId===null)throw new BadRequestException('Informe versão e justificativa válidas.');return value as Record<string,any>;}
 async upload(actor:string,id:string,value:unknown,file:OriginalFile){
  const b=this.command(id,value,['fileHash']);if(!validHash(b.fileHash))throw new BadRequestException('Hash esperado inválido.');
  // SQL Owner recheck precedes binary parsing and any provider call.
  await this.detail(actor,id);this.blob.assertEnabled();await validateOriginalPdf(file);
  const fileHash=sha256(file.buffer);if(fileHash!==b.fileHash)throw new BadRequestException('Arquivo alterado desde a conferência.');
  const reservation=await this.rpc(actor,'reserve',id,{...b,fileHash,size:file.size});
  if(reservation.replayed)return {state:reservation.state,replayed:true};
  let evidence:BlobEvidence;try{evidence=await this.blob.put(reservation.reference,file.buffer)}catch{evidence={outcome:'UNKNOWN',diagnostic:'NETWORK_OR_HTTP'}}
  return this.finish(actor,id,reservation,evidence);
 }
 async reconcile(actor:string,id:string,operationId:string,value:unknown){
  const b=this.command(id,value);if(!SOURCE_UUID.test(operationId))throw new BadRequestException('Operação inválida.');await this.detail(actor,id);this.blob.assertEnabled();
  const reservation=await this.rpc(actor,'reconcile',id,{...b,operationId});if(reservation.replayed)return {state:reservation.state,replayed:true};
  let evidence:BlobEvidence;try{evidence=await this.blob.reconcile(reservation.reference)}catch{evidence={outcome:'UNKNOWN',diagnostic:'NETWORK_OR_HTTP'}}
  return this.finish(actor,id,reservation,evidence);
 }
 private finish(actor:string,id:string,reservation:any,evidence:BlobEvidence){return this.rpc(actor,'finish',id,{requestId:randomUUID(),expectedEventId:reservation.eventId,expectedRevisionHash:reservation.revisionHash,justification:'Resultado técnico de armazenamento; não corresponde a revisão ou publicação normativa.',operationId:reservation.operationId,outcome:evidence.outcome,diagnostic:evidence.diagnostic});}
}
