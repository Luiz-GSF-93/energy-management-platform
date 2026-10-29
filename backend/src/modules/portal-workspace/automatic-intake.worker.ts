import {Injectable,Logger,OnModuleDestroy,OnModuleInit,Optional} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {AzureInvoiceConnector,OcrProviderError} from '../ocr/azure-invoice.connector';
import {extractPdfText} from '../ocr/eva-pdf-text.extractor';
import {OcrQueueService} from '../ocr/ocr-queue.service';
import {OcrAssistantService} from '../ocr/ocr-assistant.service';
import {EvaAssistedClosingService} from '../ocr/eva-assisted-closing.service';
import {BackofficeAiService,assistantAiEvidence} from '../ocr/backoffice-ai.service';
import {OcrMachineDraftService} from '../ocr/ocr-machine-draft.service';
import {automaticIntakeContext,automaticOcrIdentityConfidence} from './automatic-intake-context';
import {intakeOrganizations,intakePath} from './automatic-intake.service';
import {DOCUMENT_BUCKET} from '../documents/services/document-file';
import {portalInvoiceKind} from './portal-invoice-kind';

@Injectable()
export class AutomaticIntakeWorker implements OnModuleInit,OnModuleDestroy{
 private timer?:ReturnType<typeof setTimeout>;private stopped=false;private busy=false;private log=new Logger(AutomaticIntakeWorker.name);
 constructor(private db:SupabaseService,private connector:AzureInvoiceConnector,private ocr:OcrQueueService,private assistant:OcrAssistantService,private closing:EvaAssistedClosingService,private ai:BackofficeAiService,@Optional() private drafts?:OcrMachineDraftService){}
 onModuleInit(){if(intakeOrganizations().length)this.schedule();}
 onModuleDestroy(){this.stopped=true;if(this.timer)clearTimeout(this.timer);}
 private schedule(){if(this.stopped)return;this.timer=setTimeout(()=>void this.runOnce().catch(()=>this.log.warn('EVA_INTAKE_PENDING')).finally(()=>this.schedule()),5000);this.timer.unref?.();}
 private async rpc(name:string,body:any){const scoped=['eva_intake_work_context','transition_eva_automatic_intake','eva_intake_reference_signature','eva_intake_unit_aliases'].includes(name)&&process.env.PORTAL_MULTI_CUSTOMER_ENABLED==='true';const r=await this.db.getClient().rpc(scoped?'portal_intake_scoped_rpc':name,scoped?{p_name:name,p_args:body}:body);if(r.error)throw Object.assign(Error('EVA_INTAKE_RPC_'+name),{code:r.error.code});return r.data;}
 private async signature(i:any,job:{id:string;token:string}){
  const rows:any[]=[];
  rows.push(['referenceVersions',await this.rpc('eva_intake_reference_signature',{p_id:job.id,p_token:job.token})]);
  for(const [table,id] of [['consumer_units',i.unit_id],['customers',i.customer_id]]){const r=await this.db.getClient().from(table).select('*').eq('organization_id',i.organization_id).eq('id',id).limit(2);if(r.error||!Array.isArray(r.data)||r.data.length!==1)throw Error('SOURCE_REGISTRATION_UNAVAILABLE');rows.push([table,r.data]);}
  const tables=['documents','energy_contracts','calculation_parameters','calculation_monthly_inputs','calculation_monthly_costs','supplier_billing_rules','supplier_spot_reconciliations','calculation_cost_absences','management_contracts','management_fee_allocations','commercial_fee_adjustments','tariff_library_versions'];
  // Independent read-only captures share at most four DB requests. Preserve
  // deterministic ordering and fail closed before preparation on any error.
  for(let start=0;start<tables.length;start+=4){
   const batch=await Promise.all(tables.slice(start,start+4).map(async table=>{
   let q=this.db.getClient().from(table).select('*').eq('organization_id',i.organization_id);
   if(table!=='tariff_library_versions'&&table!=='calculation_parameters')q=q.eq('customer_id',i.customer_id);
   if(!['management_contracts','management_fee_allocations','commercial_fee_adjustments','tariff_library_versions'].includes(table))q=q.eq('consumer_unit_id',i.unit_id);
   const r=await q.order('id').limit(501);if(r.error||!Array.isArray(r.data)||r.data.length>500)throw Error('SOURCE_SIGNATURE_UNAVAILABLE');
   return [table,r.data];
   }));rows.push(...batch);
  }
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
 }
 async runOnce(){
  const organizations=intakeOrganizations();if(this.busy||this.stopped||!organizations.length)return;this.busy=true;
  try{
   const job=await this.rpc('claim_eva_automatic_intake',{p_organizations:organizations});if(!job)return;
   const transition=(action:string,body:any={})=>this.rpc('transition_eva_automatic_intake',{p_id:job.id,p_token:job.token,p_action:action,p_body:body});
   let i:any;let preparing=false;let submitting=false;let stage="SOURCE_CHECK";
   try{
    const ctx=job.context??await this.rpc('eva_intake_work_context',{p_id:job.id,p_token:job.token});i=ctx.intake;
    const t:TenantContext={scope:'organization',organizationId:i.organization_id,email:'',...ctx.delegate};
    if(i.document_id&&['RECOGNIZING','OCR_QUEUED'].includes(i.state)){
     if(i.raw_result&&i.state==='OCR_QUEUED'){await transition('use_existing_ocr');i.state='RECOGNIZING';}
     else if(!i.raw_result){
      const prior=await this.ocr.status(i.organization_id,i.document_id);
      const recoveredSupplier=i.document_type==='INVOICE_SUPPLIER'&&prior.job?.state==='FAILED'&&prior.job.errorCode==='IDENTITY_REVIEW_REQUIRED';
      if(prior.job&&!recoveredSupplier){await transition(['FAILED','SUBMISSION_UNKNOWN'].includes(prior.job.state)?'review':'wait',{note:'Consultando a leitura já existente, sem repetir o envio ao provedor.'});return;}
     }
    }
    if(['RECOGNIZING','OCR_QUEUED','OCR_POLLING','LINKING'].includes(i.state)){
     const storage=this.db.getClient().storage.from(DOCUMENT_BUCKET),original=await storage.download(intakePath(i.organization_id,i.id,i.mime));
     if(original.error||!original.data||original.data.size!==i.size_bytes)throw Error('ORIGINAL_UNAVAILABLE');
     const bytes=Buffer.from(await original.data.arrayBuffer());if(createHash('sha256').update(bytes).digest('hex')!==i.file_hash)throw Error('ORIGINAL_HASH_MISMATCH');
     if(i.state==='OCR_QUEUED'){
      if(!this.connector.isConfigured()){await transition('review',{note:'OCR indisponível. O arquivo foi preservado.'});return;}
      await transition('begin_ocr');submitting=true;
      const result=await this.connector.submit({buffer:bytes,size:bytes.length,mimetype:i.mime,originalname:i.filename},i.file_hash);
      await transition('accepted',{operation:result.url});return;
     }
     let raw=i.raw_result;
     if(i.state==='OCR_POLLING'&&!raw){
      if(i.attempts>120){await transition('review',{note:'A leitura excedeu as tentativas permitidas. O arquivo foi preservado.'});return;}
      const polled=await this.connector.poll(i.operation_url);
      if(polled.status==='running'){await transition('wait');return;}
      if(polled.status==='failed'){await transition('review',{note:'A leitura não foi concluída. Confira o arquivo original.'});return;}
      raw=polled.result;await transition('raw',{raw});
     }
     if(i.state!=='LINKING'){
      let pages:{page:number;text:string}[]=[];
      if(raw)pages=(raw.pages??[]).map((p:any)=>({page:p.pageNumber,text:(p.lines??[]).map((l:any)=>l.content).join('\n')||(p.spans??[]).map((s:any)=>String(raw.content??'').slice(s.offset,s.offset+s.length)).join('\n')}));
      else if(i.mime==='application/pdf'){
       const extraction=await extractPdfText(bytes,20000);
       if(!extraction.ocrRequired)pages=[...new Set(extraction.sections.map(s=>s.page))].map(page=>({page,text:extraction.sections.filter(s=>s.page===page).map(s=>s.text).join('\n')}));
      }
      if(!pages.length){await transition('need_ocr',{note:'Identificação por OCR necessária. Uma única leitura será usada também na preparação.'});return;}
      if(i.external&&portalInvoiceKind(pages.map(p=>p.text).join('\n'))!=='DISTRIBUTOR'){
       await transition('review',{note:'O portal aceita somente fatura de energia da distribuidora. Selecione a fatura correta; este arquivo não será arquivado como fatura nem usado no fechamento.',diagnostic:{stage:'DOCUMENT_TYPE',code:'PORTAL_INVOICE_REQUIRED'}});return;
      }
      const matches:any[]=[];
      for(const customer of ctx.customers){
       if(!pages.map(p=>p.text).join('').replace(/[^A-Z0-9]/gi,'').includes(String(customer.document??'').replace(/[^A-Z0-9]/gi,'')))continue;
       const units=ctx.units.filter((u:any)=>u.customer_id===customer.id);
       for(const unit of units){const r=await this.rpc('eva_intake_unit_aliases',{p_id:job.id,p_token:job.token,p_unit:unit.id});unit.aliases=r.codes;}
       const proof=automaticIntakeContext(pages,customer,units,i.file_hash,i.hints);if(proof.state==='MATCH'&&(!raw||automaticOcrIdentityConfidence(raw,proof,customer,units.find((u:any)=>u.id===proof.unitId))))matches.push(proof);
      }
      if(matches.length!==1){await transition('review',{note:'A leitura está disponível, mas o vínculo ainda não foi comprovado. Confira código atual/histórico da instalação, CNPJ, endereço e competência. Suas respostas anteriores foram preservadas.',diagnostic:{stage:'IDENTIFICATION',code:'IDENTITY_REVIEW_REQUIRED'}});return;}
      if(i.external&&matches[0].documentType!=='INVOICE_DISTRIBUTOR'){
       await transition('review',{note:'O portal aceita somente fatura da distribuidora. A nota do fornecedor deve ser conferida pela equipe do backoffice.',diagnostic:{stage:'DOCUMENT_TYPE',code:'PORTAL_INVOICE_REQUIRED'}});return;
      }
      await transition('recognized',{proof:matches[0]});Object.assign(i,{customer_id:matches[0].customerId,unit_id:matches[0].unitId,month:matches[0].month,document_type:matches[0].documentType,state:'LINKING'});
     }
     const path=i.organization_id+'/'+i.unit_id+'/eva-intake-'+i.id+(i.mime==='application/pdf'?'.pdf':i.mime==='image/png'?'.png':'.jpg');
     const saved=await storage.upload(path,bytes,{contentType:i.mime,upsert:false});
     if(saved.error){const same=await storage.download(path);if(same.error||!same.data||same.data.size!==bytes.length||createHash('sha256').update(Buffer.from(await same.data.arrayBuffer())).digest('hex')!==i.file_hash)throw Error('FINAL_COPY_UNCONFIRMED');}
     await transition('linked',{path,note:'Documento reconhecido e vinculado automaticamente. Fontes e original preservados.'});return;
    }
    if(i.state==='WAITING_OCR'){
     let status=await this.ocr.status(i.organization_id,i.document_id);
     if(['FAILED','SUBMISSION_UNKNOWN'].includes(status.job?.state??'')){await transition('review',{note:'A leitura requer conferência no histórico; não será repetida automaticamente.'});return;}
     if(status.job?.state!=='SUCCEEDED'){
      if(!status.job)await this.ocr.enqueue(i.organization_id,i.document_id,t.userId);
      status=await this.ocr.status(i.organization_id,i.document_id);
     }
     if(status.job?.state!=='SUCCEEDED'){await transition('wait',{note:'Leitura automática em andamento; sem novo envio.'});return;}
    }
    const history:any=await this.closing.history({consumerUnitId:i.unit_id,month:i.month,page:'0'},t);
    const approved=history.rows?.find((r:any)=>r.state==='APPROVED'&&(r.id===i.closing_id||r.report?.units?.some((u:any)=>u.id===i.unit_id&&u.documentId===i.document_id&&u.sourceHash===i.file_hash)));
    if(approved){await transition('published',{closingId:approved.id,note:'Fechamento aprovado. Históricos preservados.'});return;}
    const signature=await this.signature(i,job);
    if(i.signature===signature){await transition('wait',{note:i.note});return;}
    // A failed read-only identity check has no uncertain financial writes.
    await this.ocr.assertAutomaticIdentity(i.organization_id,i.document_id);
    stage='DRAFT_PREPARATION';await transition('begin_prepare');preparing=true;
    const drafts=await this.assistant.prepareAutomatic(i.document_id,t);
    if(drafts.receipts.some(r=>r.state==='VERIFY_REQUIRED'))throw Error('UNCONFIRMED_DRAFT_WRITE');
    if(this.drafts&&drafts.current)try{await this.drafts.fill(t,drafts.current);}catch{this.log.warn('EVA_INTAKE_FIELD_DRAFT_PENDING');}
    stage='CLOSING_PREPARATION';const result=await this.closing.prepareInvoice(i.document_id,i.file_hash,{consumerUnitId:i.unit_id,month:i.month},t);
    if(!['READY_FOR_REVIEW','INCOMPLETE'].includes(result.row?.state))throw Error('UNCONFIRMED_CLOSING_WRITE');
    const report=result.row.report,complete=report.preparation?.percent===100||report.approvalEligible===true;
    // One optional, budgeted explanation per original. Persist intent before
    // inference; a timeout or restart must never cause another paid call.
    if(!i.ai_attempted){
     await transition('begin_interpret');
     try{const plan=drafts.current??await this.assistant.inspect(i.document_id,t);const review=await this.ai.interpret(t,'Explique os preenchimentos da proposta e somente as confirmações restantes, sem inventar fontes ou valores.',assistantAiEvidence(plan),i.document_id);if(this.drafts&&review.state==='READY')await this.drafts.fill(t,plan,review);}catch{/* Source-backed proposal remains available if interpretation fails. */}
    }
    stage='FINAL_SOURCE_CHECK';const after=await this.signature(i,job);
    await transition('prepared',{closingId:result.row.id,signature:after,sourcesChanged:signature!==after,complete,note:complete?'Preenchimento da proposta concluído. Revise somente as confirmações do resumo antes de aprovar.':'A EVA preencheu as fontes disponíveis e retomará automaticamente quando os documentos ou registros pendentes forem atualizados.'});
   }catch(e){
    const unknown=preparing||submitting;
    if(submitting&&e instanceof OcrProviderError&&e.code==='RATE_LIMITED'){
     try{await transition('retry_ocr',{error:'RATE_LIMITED',delay:e.retryAfterSeconds,note:'O provedor adiou a leitura antes de aceitá-la. Aguardando o prazo informado.'});}catch{this.log.warn('EVA_INTAKE_RATE_ACK_PENDING');}return;
    }
    if(!unknown&&e instanceof OcrProviderError&&['RATE_LIMITED','PROVIDER_UNAVAILABLE'].includes(e.code)){
     try{await transition('wait',{note:'Aguardando a leitura já iniciada, sem novo envio pago.'});}catch{this.log.warn('EVA_INTAKE_POLL_ACK_PENDING');}return;
    }
    // Unknown POST/write acknowledgements never become automatic retries.
    const duplicate=['P2091','P2092','23505'].includes((e as any)?.code);
    stage=i?.state==='LINKING'?'ARCHIVING':stage;const code=String((e as any)?.code??(/^[A-Z][A-Z0-9_]{2,63}$/.test((e as any)?.message??'')?(e as any).message:typeof(e as any)?.getStatus==='function'?'HTTP_'+(e as any).getStatus():'UNAVAILABLE')).replace(/[^A-Z0-9_]/g,'').slice(0,64);
    this.log.warn('EVA_INTAKE_FAILURE '+stage+' '+code);
    try{await transition(unknown?'unknown':'review',{diagnostic:{stage,...(unknown?{cause:code}:{}),code:unknown?'UNCONFIRMED_RESULT':duplicate?'EXISTING_DOCUMENT':stage==='ARCHIVING'?'ARCHIVE_FAILED':'SOURCE_REVIEW_REQUIRED'},note:unknown?'Resultado não confirmado. Confira o histórico antes de repetir.':duplicate?'Já existe uma fatura desta unidade e competência. Confira a versão existente, sem iniciar outra leitura.':stage==='ARCHIVING'?'A identificação foi concluída, mas houve falha técnica ao arquivar. O original e suas respostas foram preservados; não reenvie o arquivo.':'A fonte ou autorização precisa de conferência. O arquivo original foi preservado.'});}catch{this.log.warn('EVA_INTAKE_ACK_PENDING');}
   }
  }finally{this.busy=false;}
 }
}
