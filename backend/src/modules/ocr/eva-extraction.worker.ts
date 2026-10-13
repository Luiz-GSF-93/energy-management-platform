import {Injectable,Logger,OnModuleDestroy,OnModuleInit} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
import {EvaExtractionBlobReader} from './eva-extraction-blob.reader';
import {ExtractionError,EXTRACTION_VERSION,uuid,validateExtractionResult} from './eva-extraction.model';
import {extractPdfText} from './eva-pdf-text.extractor';
@Injectable()
export class EvaExtractionWorker implements OnModuleInit,OnModuleDestroy{
 private timer?:ReturnType<typeof setTimeout>;private stopped=false;private busy=false;private logger=new Logger(EvaExtractionWorker.name);
 constructor(private db:SupabaseService,private config:ConfigService,private reader:EvaExtractionBlobReader){}
 enabled(){return this.config.get('EVA_OFFICIAL_EXTRACTION_ENABLED')==='true'&&this.config.get('EVA_OFFICIAL_EXTRACTION_WORKER_ENABLED')==='true'&&this.reader.enabled();}
 onModuleInit(){if(this.enabled())this.schedule();}
 onModuleDestroy(){this.stopped=true;if(this.timer)clearTimeout(this.timer);}
 private schedule(){if(this.stopped)return;this.timer=setTimeout(async()=>{try{await this.runOnce();}catch{this.logger.warn('EVA_EXTRACTION_STATE_PENDING');}finally{this.schedule();}},5000);this.timer.unref();}
 private async rpc(action:string,id:string|null,token:string|null,body:unknown){let r:any;try{r=await this.db.getClient().rpc('eva_official_extraction_worker',{p_action:action,p_job:id,p_token:token,p_body:body})}catch{throw new Error('EVA_EXTRACTION_STATE_PENDING');}if(r.error)throw new Error('EVA_EXTRACTION_STATE_PENDING');return r.data;}
 async runOnce(){
  if(this.busy||this.stopped||!this.enabled())return;this.busy=true;
  try{
   const j=await this.rpc('claim',null,null,{});if(!j)return;
   if(!uuid(j.id)||!uuid(j.token))throw new Error('EVA_EXTRACTION_STATE_PENDING');
   const start=Date.now();let result;
   try{if(j.extractor!==EXTRACTION_VERSION)throw new ExtractionError('INTEGRITY');const bytes=await this.reader.read(j);result=await extractPdfText(bytes);if(!validateExtractionResult(result))throw new ExtractionError('INTEGRITY');}
   catch(e){await this.rpc('fail',j.id,j.token,{diagnostic:e instanceof ExtractionError?e.code:'EXTRACTION_FAILED',durationMs:Math.min(600000,Date.now()-start)});return;}
   // Completion failure is not reclassified as a parser failure. Lease recovery rechecks the source.
   await this.rpc('complete',j.id,j.token,{...result,durationMs:Math.min(600000,Date.now()-start)});
  }finally{this.busy=false;}
 }
}
