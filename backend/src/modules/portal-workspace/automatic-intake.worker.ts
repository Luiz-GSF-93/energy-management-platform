import {acceptedIdentityContinuation} from './identity-continuation';
import {SUPPLIER_COST_DRAFT_VERSION} from '../ocr/supplier-invoice-cost-draft';
import {xmlIntakeDiagnostic} from './xml-intake-context';
import {companyTaxIdentity} from '../ocr/eva-preparation-policy';
import {readFiscalXml,xmlUnitMatch} from '../ocr/fiscal-xml';
import {captureInvoiceAssessment} from '../ocr/invoice-assessment';
import {AneelTariffFlagsService} from '../ocr/aneel-tariff-flags.service';
import {supplementalTariffFlagReference} from '../ocr/supplemental-tariff-flag-reference';
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
import {intakeIdentityDiagnostic} from './automatic-intake-triage';
import {intakeOrganizations,intakeWorkerOrganizations,intakePath} from './automatic-intake.service';
import {DOCUMENT_BUCKET} from '../documents/services/document-file';
import {portalInvoiceKind} from './portal-invoice-kind';

@Injectable()
export class AutomaticIntakeWorker implements OnModuleInit,OnModuleDestroy{
 private timer?:ReturnType<typeof setTimeout>;private stopped=false;private busy=false;private log=new Logger(AutomaticIntakeWorker.name);
 constructor(private db:SupabaseService,private connector:AzureInvoiceConnector,private ocr:OcrQueueService,private assistant:OcrAssistantService,private closing:EvaAssistedClosingService,private ai:BackofficeAiService,@Optional() private drafts?:OcrMachineDraftService,@Optional() private officialFlags?:AneelTariffFlagsService){}
 onModuleInit(){if(intakeOrganizations().length)this.schedule();}
 onModuleDestroy(){this.stopped=true;if(this.timer)clearTimeout(this.timer);}
 private schedule(){if(this.stopped)return;this.timer=setTimeout(()=>void this.runOnce().catch(()=>this.log.warn('EVA_INTAKE_PENDING')).finally(()=>this.schedule()),5000);this.timer.unref?.();}
 private async rpc(name:string,body:any){const scoped=['eva_intake_work_context','transition_eva_automatic_intake','eva_intake_reference_signature','eva_intake_unit_aliases'].includes(name)&&process.env.PORTAL_MULTI_CUSTOMER_ENABLED==='true';const r=await this.db.getClient().rpc(scoped?'portal_intake_scoped_rpc':name,scoped?{p_name:name,p_args:body}:body);if(r.error)throw Object.assign(Error('EVA_INTAKE_RPC_'+name),{code:r.error.code});return r.data;}
 private async sourceState(i:any,job:{id:string;token:string}){
  const officialFlag=await this.officialFlags?.reference(i.organization_id,i.month);
  const state=await this.rpc('eva_intake_source_state',{p_id:job.id,p_token:job.token});
  if(typeof state?.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(state.fingerprint)||!Number.isSafeInteger(state.revision)||state.revision<0)throw Error('SOURCE_SIGNATURE_UNAVAILABLE');
  return {revision:state.revision,signature:createHash('sha256').update(JSON.stringify(['intake-fingerprint-3',SUPPLIER_COST_DRAFT_VERSION,state.fingerprint,officialFlag??null,supplementalTariffFlagReference(i.month)??null])).digest('hex')};
 }
 private async signature(i:any,job:{id:string;token:string}){return (await this.sourceState(i,job)).signature;}
 async runOnce(){
  if(this.busy||this.stopped||!intakeOrganizations().length)return;this.busy=true;
  try{
   const organizations=await intakeWorkerOrganizations(this.db.getClient(),'INTAKE');if(!organizations.length)return;
   const job=await this.rpc('claim_eva_automatic_intake',{p_organizations:organizations});if(!job)return;
   const transition=(action:string,body:any={},revision?:number)=>this.rpc(revision===undefined?'transition_eva_automatic_intake':'eva_intake_revision_transition',{p_id:job.id,p_token:job.token,p_action:action,p_body:body,...(revision===undefined?{}:{p_revision:revision})});
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
     let raw=i.raw_result;
     if(i.state==='OCR_POLLING'&&!raw){
      if(i.attempts>120){await transition('review',{note:'A leitura excedeu as tentativas permitidas. O arquivo foi preservado.'});return;}
      const polled=await this.connector.poll(i.operation_url);
      if(polled.status==='running'){await transition('wait');return;}
      if(polled.status==='failed'){await transition('review',{note:'A leitura não foi concluída. Confira o arquivo original.'});return;}
      raw=polled.result;await transition('raw',{raw});
     }
     const storage=this.db.getClient().storage.from(DOCUMENT_BUCKET),original=await storage.download(intakePath(i.organization_id,i.id,i.mime));
     if(original.error||!original.data||original.data.size!==i.size_bytes)throw Error('ORIGINAL_UNAVAILABLE');
     const bytes=Buffer.from(await original.data.arrayBuffer());if(createHash('sha256').update(bytes).digest('hex')!==i.file_hash)throw Error('ORIGINAL_HASH_MISMATCH');
     const xml=i.mime==='application/xml'?readFiscalXml(bytes):null;
     if(xml){raw=xml.raw;await this.rpc('eva_intake_xml_source',{p_id:job.id,p_token:job.token,p_raw:raw});}
     if(i.state==='OCR_QUEUED'&&!xml){
      if(!this.connector.isConfigured()){await transition('review',{note:'OCR indisponível. O arquivo foi preservado.'});return;}
      await transition('begin_ocr');submitting=true;
      const result=await this.connector.submit({buffer:bytes,size:bytes.length,mimetype:i.mime,originalname:i.filename},i.file_hash);
      await transition('accepted',{operation:result.url});return;
     }
     if(i.state!=='LINKING'){
      let pages:{page:number;text:string}[]=[];
      if(raw)pages=(raw.pages??[]).map((p:any)=>({page:p.pageNumber,text:(p.lines??[]).map((l:any)=>l.content).join('\n')||(p.spans??[]).map((s:any)=>String(raw.content??'').slice(s.offset,s.offset+s.length)).join('\n')}));
      else if(i.mime==='application/pdf'){
       const extraction=await extractPdfText(bytes,20000);
       if(!extraction.ocrRequired)pages=[...new Set(extraction.sections.map(s=>s.page))].map(page=>({page,text:extraction.sections.filter(s=>s.page===page).map(s=>s.text).join('\n')}));
      }
      if(!pages.length){await transition('need_ocr',{note:'Identificação por OCR necessária. Uma única leitura será usada também na preparação.'});return;}
      if(i.external&&(xml?xml.fiscal.kind!=='INVOICE_DISTRIBUTOR':portalInvoiceKind(pages.map(p=>p.text).join('\n'))!=='DISTRIBUTOR')){
       await transition('review',{note:'O portal aceita somente fatura de energia da distribuidora. Selecione a fatura correta; este arquivo não será arquivado como fatura nem usado no fechamento.',diagnostic:{stage:'DOCUMENT_TYPE',code:'PORTAL_INVOICE_REQUIRED'}});return;
      }
      const matches:any[]=[];let identityDiagnostic:any=null;let identityReview:any=null;
      const aliasCatalog=await this.rpc('eva_intake_alias_catalog',{p_id:job.id,p_token:job.token});
      if(!aliasCatalog||typeof aliasCatalog!=='object'||Array.isArray(aliasCatalog))throw Error('ALIAS_CATALOG_UNAVAILABLE');
      for(const customer of ctx.customers){
       const identityText=pages.map(p=>p.text).join('\n').toUpperCase();
       const related=[...identityText.matchAll(/\b[0-9A-Z]{2}\.?[0-9A-Z]{3}\.?[0-9A-Z]{3}\s*\/?\s*[0-9A-Z]{4}-?[0-9]{2}\b/g)].some(m=>companyTaxIdentity(customer.document,[m[0]],{unit:false,address:false,period:false}).relation==='SAME_ROOT');
       if(customer.id!==i.customer_id&&!identityText.replace(/[^A-Z0-9]/g,'').includes(String(customer.document??'').toUpperCase().replace(/[^A-Z0-9]/g,''))&&!related)continue;
       const units=ctx.units.filter((u:any)=>u.customer_id===customer.id);
       for(const unit of units){const codes=aliasCatalog[unit.id];if(!Array.isArray(codes)||codes.some((v:unknown)=>typeof v!=='string'))throw Error('ALIAS_CATALOG_UNAVAILABLE');unit.aliases=codes;}
       const selected=units.find((u:any)=>u.id===i.hints?.unitId);
       if(customer.id===i.customer_id&&selected&&i.hints?.month){
        identityDiagnostic=xml?xmlIntakeDiagnostic(xml,customer,selected,i.hints.month):intakeIdentityDiagnostic(pages,customer,selected,i.file_hash,i.hints.month,raw);
        if(identityDiagnostic){identityReview=await this.rpc('eva_intake_identity_resume_proof',{p_id:job.id,p_token:job.token,p_diagnostic:identityDiagnostic});if(identityReview.rejected)return;
         if(identityReview.accepted&&identityReview.unitCode)selected.aliases=[...new Set([...selected.aliases,identityReview.unitCode])];
         if(identityReview.accepted&&identityReview.address)selected.auditedAddresses=[identityReview.address];
        }
       }
       if(xml){
        const month=xml.fiscal.months.length===1?xml.fiscal.months[0]:null;
        if(month&&(!i.hints?.month||i.hints.month===month))for(const unit of units){
         if(i.hints?.unitId&&i.hints.unitId!==unit.id)continue;
         const proof=xmlUnitMatch(xml.fiscal,customer,unit,month);
         if(proof.matched)matches.push({version:'automatic-intake-context-1',state:'MATCH',fileHash:i.file_hash,customerId:customer.id,unitId:unit.id,month,documentType:xml.fiscal.kind,sourceKind:'XML',taxIdentity:proof.taxIdentity});
        }
        continue;
       }
       const proof=automaticIntakeContext(pages,customer,units,i.file_hash,i.hints);if(proof.state==='MATCH'&&(!raw||automaticOcrIdentityConfidence(raw,proof,customer,units.find((u:any)=>u.id===proof.unitId))||proof.unitId===selected?.id&&acceptedIdentityContinuation(identityReview,identityDiagnostic)))matches.push(proof);
      }
      if(matches.length!==1){const fields=identityDiagnostic?.fields?.filter((f:any)=>f.status!=='MATCH');await transition('review',{note:fields?.length?'Confira '+fields.map((f:any)=>f.label+': '+(f.status==='MISMATCH'?'diferente do cadastro':'não comprovado')).join('; ')+'. A leitura e suas respostas foram preservadas.':'A leitura está disponível. Selecione o cliente, a unidade e a competência para conferir os campos do original.',diagnostic:{stage:'IDENTIFICATION',code:'IDENTITY_REVIEW_REQUIRED'}});if(identityDiagnostic?.fingerprint)await this.rpc('eva_intake_continue_requested',{p_id:job.id,p_fingerprint:identityDiagnostic.fingerprint});return;}
      if(i.external&&matches[0].documentType!=='INVOICE_DISTRIBUTOR'){
       await transition('review',{note:'O portal aceita somente fatura da distribuidora. A nota do fornecedor deve ser conferida pela equipe do backoffice.',diagnostic:{stage:'DOCUMENT_TYPE',code:'PORTAL_INVOICE_REQUIRED'}});return;
      }
      await transition('recognized',{proof:matches[0]});Object.assign(i,{customer_id:matches[0].customerId,unit_id:matches[0].unitId,month:matches[0].month,document_type:matches[0].documentType,state:'LINKING'});
     }
     const path=i.organization_id+'/'+i.unit_id+'/eva-intake-'+i.id+(i.mime==='application/xml'?'.xml':i.mime==='application/pdf'?'.pdf':i.mime==='image/png'?'.png':'.jpg');
     const saved=await storage.upload(path,bytes,{contentType:i.mime,upsert:false});
     if(saved.error){const same=await storage.download(path);if(same.error||!same.data||same.data.size!==bytes.length||createHash('sha256').update(Buffer.from(await same.data.arrayBuffer())).digest('hex')!==i.file_hash)throw Error('FINAL_COPY_UNCONFIRMED');}
     await transition('linked',{path,note:'Documento reconhecido e vinculado automaticamente. Fontes e original preservados.'});return;
    }
    if(i.state==='WAITING_OCR'){
     if(i.mime==='application/xml'){
      const stored=await this.db.getClient().storage.from(DOCUMENT_BUCKET).download(intakePath(i.organization_id,i.id,i.mime));
      if(stored.error||!stored.data||stored.data.size!==i.size_bytes)throw Error('XML_ORIGINAL_UNAVAILABLE');
      const xml=readFiscalXml(Buffer.from(await stored.data.arrayBuffer()));
      if(xml.fiscal.sourceHash!==i.file_hash)throw Error('XML_SOURCE_HASH_MISMATCH');
      const assessment=await captureInvoiceAssessment(this.db.getClient(),{organization_id:i.organization_id,document_id:i.document_id,file_hash:i.file_hash},xml.raw);
      await this.rpc('eva_intake_xml_complete',{p_id:job.id,p_token:job.token,p_assessment:assessment});
     }
     let status=await this.ocr.status(i.organization_id,i.document_id);
     if(status.job?.state==='FAILED'&&status.job.errorCode==='PROVIDER_REJECTED'&&i.raw_result){const recovered=await this.rpc('eva_intake_recover_preserved_ocr',{p_id:job.id,p_token:job.token});if(recovered){await transition('wait',{note:'Reutilizando a leitura concluída preservada, sem nova consulta ao provedor ou desconto de documento.'});return;}}
     if(['FAILED','SUBMISSION_UNKNOWN'].includes(status.job?.state??'')){await transition('review',{note:'A leitura requer conferência no histórico; não será repetida automaticamente.'});return;}
     if(status.job?.state!=='SUCCEEDED'){
      if(!status.job)await this.ocr.enqueue(i.organization_id,i.document_id,t.userId);
      status=await this.ocr.status(i.organization_id,i.document_id);
     }
     if(status.job?.state!=='SUCCEEDED'){await transition('wait',{note:'Leitura automática em andamento; sem novo envio.'});return;}
    }
    const history:any=await this.closing.history({consumerUnitId:i.unit_id,month:i.month,scopeKind:'UNIT',page:'0'},t);
    const matchesApproved=(r:any)=>r.state==='APPROVED'&&(r.id===i.closing_id||r.report?.units?.some((u:any)=>u.id===i.unit_id&&u.documentId===i.document_id&&u.sourceHash===i.file_hash));
    let approved=history.rows?.find(matchesApproved);
    if(!approved){
     const consolidated:any=await this.closing.history({consumerUnitId:i.unit_id,month:i.month,scopeKind:'CUSTOMER',page:'0'},t);
     approved=consolidated.rows?.find(matchesApproved);
    }
    if(approved){await transition('published',{closingId:approved.id,note:'Fechamento aprovado. Históricos preservados.'});return;}
    const before=await this.sourceState(i,job),signature=before.signature;
    if(i.signature===signature){await transition('wait',{note:i.note},before.revision);return;}
    // A failed read-only identity check has no uncertain financial writes.
    await this.ocr.assertAutomaticIdentity(i.organization_id,i.document_id);
    stage='DRAFT_PREPARATION';await transition('begin_prepare');preparing=true;
    const drafts=await this.assistant.prepareAutomatic(i.document_id,t);
    if(drafts.receipts.some(r=>r.state==='VERIFY_REQUIRED'))throw Error('UNCONFIRMED_DRAFT_WRITE');
    if(this.drafts&&drafts.current)try{await this.drafts.fill(t,drafts.current);}catch{this.log.warn('EVA_INTAKE_FIELD_DRAFT_PENDING');}
    stage='CLOSING_PREPARATION';const result=await this.closing.prepareInvoice(i.document_id,i.file_hash,{consumerUnitId:i.unit_id,month:i.month},t);
    if(!['READY_FOR_REVIEW','INCOMPLETE'].includes(result.row?.state))throw Error('UNCONFIRMED_CLOSING_WRITE');
    const report=result.row.report,complete=report.preparation?.percent===100||report.approvalEligible===true;
    // The prepared transition atomically queues an optional explanation.
    // Model latency and failure never gate these deterministic fields.
    stage='FINAL_SOURCE_CHECK';const after=await this.sourceState(i,job),sourcesChanged=signature!==after.signature;
    // A later signature does not attest the inputs of the result just prepared.
    // Keep the earlier signature dirty; the next pass must consume new sources.
    await transition('prepared',{closingId:result.row.id,signature:sourcesChanged?signature:after.signature,sourcesChanged,complete,note:sourcesChanged?'Uma fonte mudou durante a preparação. Resultado preservado; a EVA vai reconferir a competência sem repetir OCR.':complete?'Preenchimento da proposta concluído. Revise somente as confirmações do resumo antes de aprovar.':'A EVA preencheu as fontes disponíveis e retomará automaticamente quando os documentos ou registros pendentes forem atualizados.'},after.revision);
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
    try{await transition(unknown?'unknown':'review',{diagnostic:{stage,cause:code,code:unknown?'UNCONFIRMED_RESULT':duplicate?'EXISTING_DOCUMENT':stage==='ARCHIVING'?'ARCHIVE_FAILED':'SOURCE_REVIEW_REQUIRED'},note:unknown?'Resultado não confirmado. Confira o histórico antes de repetir.':duplicate?'Já existe uma fatura desta unidade e competência. Confira a versão existente, sem iniciar outra leitura.':stage==='ARCHIVING'?'A identificação foi concluída, mas houve falha técnica ao arquivar. O original e suas respostas foram preservados; não reenvie o arquivo.':'A fonte ou autorização precisa de conferência. O arquivo original foi preservado.'});}catch{this.log.warn('EVA_INTAKE_ACK_PENDING');}
   }
  }finally{this.busy=false;}
 }
}
