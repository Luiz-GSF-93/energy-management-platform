import {legalFileLookup,appendLegalFileEvidence} from './legal-library-context';
import {Injectable,Logger,OnModuleDestroy,OnModuleInit} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
import {EvaPoller} from '../../common/workers/eva-poller';
import {scheduledWorkEnabled} from '../../common/workers/process-role';
import {BackofficeAiService} from './backoffice-ai.service';
import {AzureInvoiceConnector,azureConfig,OcrProviderError} from './azure-invoice.connector';
import {extractPdfText} from './eva-pdf-text.extractor';
import {ExtractionError} from './eva-extraction.model';
import {LEGAL_VERSION,legalPages,legalChunks,legalFindings,legalCoverage,legalHash} from './legal-audit.model';
import {legalEvidence} from './legal-audit.service';
import {legalAuditPdf} from './legal-audit.pdf';
@Injectable()
export class LegalAuditWorker implements OnModuleInit,OnModuleDestroy{
 private poller=new EvaPoller();private busy=false;private logger=new Logger(LegalAuditWorker.name);private ocr=new AzureInvoiceConnector(azureConfig(process.env),fetch,'prebuilt-read');
 constructor(private db:SupabaseService,private config:ConfigService,private ai:BackofficeAiService){}
 onModuleInit(){if(scheduledWorkEnabled('EVA')&&this.config.get('LEGAL_AUDIT_ENABLED')==='true'&&this.config.get('LEGAL_AUDIT_WORKER_ENABLED')==='true')this.poller.start(()=>this.runOnce(),5000,()=>this.logger.warn('LEGAL_AUDIT_RECEIPT_PENDING'));}
 onModuleDestroy(){this.poller.stop();}
 private async rpc(action:string,id:string|null,token:string|null,body:any={}){const r=await this.db.getClient().rpc('legal_audit_worker',{p_action:action,p_id:id,p_token:token,p_body:body});if(r.error)throw Error('LEGAL_CHECKPOINT_UNCONFIRMED');return r.data;}
 private async original(j:any,d:any){if(d.bucket!=='energy-documents-private'||!d.path?.startsWith(j.organization_id+'/'+j.unit_id+'/')||d.path.split('/').some((s:string)=>['','..','.'].includes(s))||d.hash!==j.source_hash||d.size>15728640)throw Error('LEGAL_SOURCE_INTEGRITY');const r=await this.db.getClient().storage.from(d.bucket).download(d.path);if(r.error||!r.data)throw Error('LEGAL_ORIGINAL_UNAVAILABLE');const bytes=Buffer.from(await r.data.arrayBuffer());if(bytes.length!==d.size||legalHash(bytes)!==d.hash)throw Error('LEGAL_SOURCE_INTEGRITY');return bytes;}
 async runOnce(){if(this.busy)return;this.busy=true;let packet:any,j:any,start=Date.now(),paid=false;
  try{
   packet=await this.rpc('claim',null,null);if(!packet)return;this.poller.activity();j=packet.job;const token=j.lease_token,t=packet.context;
   if(j.state==='EXTRACTING'){
    const bytes=await this.original(j,packet.document);let pages:any[]|null=null;
    if(packet.document.mime==='application/pdf'){
     const extracted=await extractPdfText(bytes,20000);
     if(!extracted.ocrRequired){pages=Array.from({length:extracted.pageCount},(_,i)=>{const parts=extracted.sections.filter(s=>s.page===i+1);return {page:i+1,text:parts.map(s=>s.text).join(''),issues:[...new Set(parts.flatMap(s=>s.issues))]};});}
    }
    if(pages){await this.rpc('reading',j.id,token,{pages:legalPages(pages),durationMs:Date.now()-start});return;}
    if(!this.ocr.isConfigured())throw Error('LEGAL_OCR_NOT_CONFIGURED');
    await this.rpc('ocr_begin',j.id,token);paid=true;const accepted=await this.ocr.submit({buffer:bytes,size:bytes.length,mimetype:packet.document.mime,originalname:packet.document.filename},j.source_hash);
    await this.rpc('ocr_accepted',j.id,token,{operation:accepted.url,durationMs:Date.now()-start});return;
   }
   if(j.state==='OCR_POLLING'){
    if(j.attempts>240)throw Error('LEGAL_OCR_POLL_LIMIT');
    const result=await this.ocr.poll(j.operation_url);if(result.status==='running'){await this.rpc('ocr_wait',j.id,token);return;}if(result.status==='failed')throw Error('LEGAL_OCR_FAILED');
    const content=String(result.result.content),raw=result.result.pages as any[];if(!raw.length||raw.length>100)throw Error('LEGAL_PAGE_LIMIT');
    const pages=raw.map((p,i)=>{if(p.pageNumber!==i+1||!Array.isArray(p.spans)||!p.spans.length||p.spans.some((s:any)=>!Number.isInteger(s.offset)||!Number.isInteger(s.length)||s.offset<0||s.length<1||s.offset+s.length>content.length))throw Error('LEGAL_OCR_PAGE_EVIDENCE_INVALID');return {page:p.pageNumber,text:p.spans.map((s:any)=>content.slice(s.offset,s.offset+s.length)).join('\n'),issues:['OCR_REQUIRES_VISUAL_REVIEW']};});await this.rpc('reading',j.id,token,{pages:legalPages(pages),durationMs:Date.now()-start});return;
   }
   if(j.state==='ANALYZING'){
    const chunks=legalChunks(j.pages);
    if(j.cursor<chunks.length){
     const c=chunks[j.cursor],evidence=legalEvidence(c,j.sources),files=await legalFileLookup(this.db,t,c.text.slice(0,3000)),fileReferences=appendLegalFileEvidence(evidence,files);paid=true;
     const result=await this.ai.interpret(t,'Revise o bloco contratual: obrigações, riscos, ambiguidades, cessão, garantias, penalidades e providências. Diferencie texto contratual de norma e indique evidências. Não conclua validade integral. Considere a data-base '+String(j.as_of).slice(0,10)+'.',evidence,j.document_id,'AUDITORIA',{settleRejectedUsage:true,legalProfile:true});
     if(result.retryAfterSeconds){await this.rpc('defer',j.id,token,{delay:60});return;}
     if(result.state==='FAILED')throw Error(result.consumptionState==='PENDING'?'AI_RESULT_UNKNOWN':'LEGAL_AI_FAILED');
     if(['NOT_AUTHORIZED','NOT_CONFIGURED'].includes(result.state))throw Error('LEGAL_AI_ACCESS_REQUIRED');
     const citations=(result.evidence??[]).map(e=>e.id),narrative={fileReferences:fileReferences.map(f=>({...f,cited:citations.includes(f.id)})),chunkId:c.id,page:c.page,pages:c.pages,state:result.state,answer:result.answer??'Não foi possível fundamentar uma interpretação deste bloco. Confira o original e a cobertura normativa.',citations,normativeSupported:citations.some(s=>s.startsWith('law-')),model:result.model??null,promptVersion:result.promptVersion??null};
     await this.rpc('analysis',j.id,token,{cursor:j.cursor,narrative,durationMs:Date.now()-start});return;
    }
    const names=await Promise.all([this.db.getClient().from('customers').select('company_name').eq('organization_id',j.organization_id).eq('id',j.customer_id).maybeSingle(),this.db.getClient().from('consumer_units').select('name').eq('organization_id',j.organization_id).eq('customer_id',j.customer_id).eq('id',j.unit_id).maybeSingle(),this.db.getClient().from('organizations').select('name').eq('id',j.organization_id).is('deleted_at',null).maybeSingle()]);if(names.some(r=>r.error||!r.data))throw Error('LEGAL_SOURCE_CONTEXT_UNAVAILABLE');
    const report={version:LEGAL_VERSION,analysisId:j.id,organizationName:names[2].data.name,customerName:names[0].data.company_name,unitName:names[1].data.name,asOf:j.as_of,sourceHash:j.source_hash,coverage:legalCoverage(j.pages,j.sources),findings:legalFindings(j.pages,j.sources),narratives:j.narratives,sources:j.sources,fileReferences:[...new Map(j.narratives.flatMap((n:any)=>n.fileReferences??[]).map((f:any)=>[f.id,f])).values()],financialApproval:false,professionalReviewRequired:true};await this.rpc('report',j.id,token,{report,durationMs:Date.now()-start});return;
   }
   if(j.state==='REPORTING'){
    const bytes=await legalAuditPdf(j,j.report),hash=legalHash(bytes),path=j.organization_id+'/'+j.unit_id+'/legal-audit/'+j.id+'/'+j.report_document_id+'.pdf',storage=this.db.getClient().storage.from('energy-documents-private');
    if(bytes.length>15728640)throw Error('LEGAL_REPORT_LIMIT');const written=await storage.upload(path,bytes,{contentType:'application/pdf',upsert:false});
    if(written.error){const previous=await storage.download(path);if(previous.error||!previous.data||legalHash(Buffer.from(await previous.data.arrayBuffer()))!==hash)throw Error('LEGAL_ARCHIVE_UNCONFIRMED');}
    await this.rpc('complete',j.id,token,{hash,size:bytes.length,durationMs:Date.now()-start});return;
   }
  }catch(e){
   if(!j)return;const code=e instanceof OcrProviderError?e.code:e instanceof ExtractionError?e.code:e instanceof Error?e.message:'LEGAL_STAGE_FAILED';
   if(j.state==='OCR_POLLING'&&e instanceof OcrProviderError&&['RATE_LIMITED','PROVIDER_UNAVAILABLE'].includes(e.code)){try{await this.rpc('defer',j.id,j.lease_token,{delay:Math.min(300,Math.max(5,e.retryAfterSeconds??30))});}catch{this.logger.warn('LEGAL_AUDIT_RECEIPT_PENDING');}return;}
   // A lost checkpoint after a paid call is uncertain. Never repeat OCR/AI automatically.
   const unknown=code==='SUBMISSION_UNKNOWN'||code==='AI_RESULT_UNKNOWN'||paid&&code==='LEGAL_CHECKPOINT_UNCONFIRMED';
   const note=unknown?(j.state==='EXTRACTING'?'OCR_SUBMISSION_UNKNOWN':'AI_RESULT_UNKNOWN')+' — confira histórico técnico e consumo antes de repetir.':code==='LIMIT'||code==='LEGAL_PAGE_LIMIT'?'O arquivo excedeu os limites de leitura (100 páginas, 15 MB ou tempo por etapa). Confira o original.':code==='LEGAL_AI_ACCESS_REQUIRED'?'Renove o acesso e confira a cota de IA para retomar.':'Etapa não concluída: '+(code.startsWith('LEGAL_')?code:'PROVIDER_OR_READING_UNAVAILABLE')+'. A leitura e os blocos já salvos foram preservados.';
   try{await this.rpc('fail',j.id,j.lease_token,{state:unknown?'TECHNICAL_REVIEW':code==='LEGAL_AI_ACCESS_REQUIRED'?'ACCESS_REQUIRED':'FAILED',note,durationMs:Date.now()-start});}catch{this.logger.warn('LEGAL_AUDIT_RECEIPT_PENDING');}
  }finally{this.busy=false;}
 }
}
