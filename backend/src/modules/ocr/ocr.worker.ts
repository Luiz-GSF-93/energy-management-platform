import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SupabaseService } from '../../services/supabase.service';
import { LicensesService } from '../licenses/services/licenses.service';
import { AzureInvoiceConnector, OcrProviderError } from './azure-invoice.connector';
import { extractInvoiceEvidence } from './invoice-evidence';
import { DOCUMENT_BUCKET, MAX_DOCUMENT_BYTES } from '../documents/services/document-file';
@Injectable()
export class OcrWorker implements OnModuleInit,OnModuleDestroy {
 private timer?:ReturnType<typeof setTimeout>; private stopped=false; private busy=false;
 private readonly logger=new Logger(OcrWorker.name);
 constructor(private readonly db:SupabaseService,private readonly licenses:LicensesService,private readonly connector:AzureInvoiceConnector){}
 onModuleInit(){if(this.connector.isConfigured())this.schedule();}
 onModuleDestroy(){this.stopped=true;if(this.timer)clearTimeout(this.timer);}
 private schedule(){if(this.stopped)return;this.timer=setTimeout(async()=>{try{await this.runOnce();}catch{this.logger.warn('OCR_WORKER_RETRY_PENDING');}finally{this.schedule();}},5000);this.timer.unref();}
 private async change(job:any,action:string,extra:Record<string,unknown>={}){
  const {error}=await this.db.getClient().rpc('transition_document_ocr',{p_id:job.id,p_token:job.lease_token,p_action:action,...extra});
  if(error)throw new Error('OCR_STATE_NOT_CONFIRMED');
 }
 async runOnce(){
  if(this.busy||this.stopped||!this.connector.isConfigured())return;
  this.busy=true;
  try{
   const {data,error}=await this.db.getClient().rpc('claim_document_ocr');
   if(error)throw new Error('OCR_QUEUE_UNAVAILABLE');
   const job=data?.[0];if(!job)return;
   if(job.attempts>120){await this.change(job,'FAIL',{p_error:'RETRY_LIMIT'});return;}
   try{await this.licenses.requireEntitlement(job.organization_id,'document_management');}
   catch{await this.change(job,'FAIL',{p_error:'LICENSE_UNAVAILABLE'});return;}
   if(job.state==='POLLING'){
    let polled;
    try{polled=await this.connector.poll(job.operation_url);}
    catch(e){
     const code=e instanceof OcrProviderError?e.code:'PROVIDER_UNAVAILABLE';
     const retry=['RATE_LIMITED','PROVIDER_UNAVAILABLE'].includes(code);
     await this.change(job,retry?'WAIT':'FAIL',{p_error:code,p_delay:e instanceof OcrProviderError?(e.retryAfterSeconds??30):30});return;
    }
    if(polled.status==='running'){await this.change(job,'WAIT',{p_delay:polled.retryAfterSeconds});return;}
    if(polled.status==='failed'){await this.change(job,'FAIL',{p_error:'ANALYSIS_FAILED'});return;}
    // Completion + evidence are atomic; a failed acknowledgement is safe to resume by GET.
    await this.change(job,'COMPLETE',{p_result:polled.result,p_evidence:extractInvoiceEvidence(polled.result)});return;
   }
   const {data:doc,error:docError}=await this.db.getClient().from('documents').select('*').eq('id',job.document_id).eq('organization_id',job.organization_id).maybeSingle();
   if(docError)throw new Error('OCR_SOURCE_LOOKUP_PENDING');
   const prefix=job.organization_id+'/'+doc?.consumer_unit_id+'/';
   if(!doc||doc.file_verified!==true||doc.document_type!=='INVOICE_DISTRIBUTOR'||doc.storage_bucket!==DOCUMENT_BUCKET||doc.file_hash!==job.file_hash||typeof doc.file_path!=='string'||!doc.file_path.startsWith(prefix)||doc.file_path.includes('..')||doc.file_path.slice(prefix.length).includes('/')||doc.file_size_bytes>MAX_DOCUMENT_BYTES){await this.change(job,'FAIL',{p_error:'SOURCE_INVALID'});return;}
   const {data:blob,error:downloadError}=await this.db.getClient().storage.from(DOCUMENT_BUCKET).download(doc.file_path);
   if(downloadError||!blob)throw new Error('OCR_SOURCE_DOWNLOAD_PENDING');
   if(blob.size>MAX_DOCUMENT_BYTES){await this.change(job,'FAIL',{p_error:'SOURCE_INVALID'});return;}
   const file={buffer:Buffer.from(await blob.arrayBuffer()),size:doc.file_size_bytes,mimetype:doc.mime_type,originalname:doc.original_filename};
   // Commit the intent BEFORE POST. A crash after this point becomes UNKNOWN, not a second POST.
   await this.change(job,'BEGIN_SUBMISSION');
   let submitted;
   try{submitted=await this.connector.submit(file,job.file_hash);}
   catch(e){
    const code=e instanceof OcrProviderError?e.code:'SUBMISSION_UNKNOWN';
    await this.change(job,code==='RATE_LIMITED'?'RETRY_SUBMISSION':code==='SUBMISSION_UNKNOWN'?'UNKNOWN':'FAIL',{p_error:code,p_delay:e instanceof OcrProviderError?(e.retryAfterSeconds??30):30});return;
   }
   await this.change(job,'ACCEPTED',{p_operation:submitted.url,p_delay:submitted.retryAfterSeconds});
  }finally{this.busy=false;}
 }
}
