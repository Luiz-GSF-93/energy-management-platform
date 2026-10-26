import {SourcePreparationService} from './source-preparation.service';
import {identityResumeEnabled} from './ocr-identity-resume';
import {createHash} from 'node:crypto';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {ocrDraftRole} from './ocr-draft-access';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {sourcePreparationEnabled} from './source-preparation-v3';
import {identityPreview} from './identity-preview';
import {ocrReadOnce} from './ocr-read-scope';
import {elektroMeasurementAudit} from './elektro-measurement-audit';
import {reconcileDemand} from './demand-reconciliation';
import {loadDemandRegistration} from './demand-registration';
import {extractCpflPaulistaLayout} from './cpfl-paulista-layout';
import {invoiceReadout,ocrReadoutSummary,ReadoutQuery} from './invoice-readout';
import {extractGdEvidence} from './gd-evidence';
import { extractElectricalEvidence } from './electrical-evidence';
import { assessmentMatchesDocument } from './invoice-assessment';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { SupabaseService } from '../../services/supabase.service';
import { LicensesService } from '../licenses/services/licenses.service';
import { AzureInvoiceConnector } from './azure-invoice.connector';
@Injectable()
export class OcrQueueService {
 constructor(private readonly db:SupabaseService, private readonly licenses:LicensesService, private readonly connector:AzureInvoiceConnector,private readonly sourcePreparation?:SourcePreparationService){}
 private async identityResumeAccess(t:TenantContext){
  if(!identityResumeEnabled())throw new ServiceUnavailableException('Retomada de identidade ainda não habilitada.');
  if(!ocrDraftRole(t)||!t.roleId||!t.permissions?.includes(P.ENERGIA_OCR_PROCESS)||!t.permissions.includes(P.DOCUMENTS_VIEW))throw new ForbiddenException('Retomada restrita à equipe interna autorizada.');
  await this.licenses.requireEntitlement(t.organizationId,'document_management');
  if(!this.connector.isConfigured())throw new ServiceUnavailableException('Leitura automática indisponível.');
 }
 private async resumeRpc(document:string,t:TenantContext,action:string,extra:Record<string,unknown>={}){
  const r=await this.db.getClient().rpc('ocr_identity_resume_action',{p_org:t.organizationId,p_document:document,p_actor:t.userId,p_role:t.roleId,p_platform:t.accessMode==='platform_operation',p_action:action,...extra});
  if(r.error?.code==='42501')throw new ForbiddenException('Cadastro, licença ou permissão de retomada indisponível.');
  if(r.error?.code==='22023')throw new BadRequestException('Confira a identidade atual e a justificativa.');
  if(r.error)throw new ConflictException('Retomada não confirmada. Consulte o status e o histórico antes de repetir.');
  return r.data;
 }
 private async resumeSnapshot(document:string,t:TenantContext){
  await this.identityResumeAccess(t);
  let captured=await this.resumeRpc(document,t,'inspect');
  if(!captured?.eligible&&!captured?.canRecheck)return {eligible:false as const,reason:captured?.reason??'Leitura sem elegibilidade para retomada.'};
  if(!this.sourcePreparation)throw new ServiceUnavailableException('Conferência local da fonte indisponível.');
  const proof=await this.sourcePreparation.invoiceIdentity(t.organizationId,captured.customerId,captured.unitId,document,captured.registration);
  const checks:Record<string,unknown>=proof?.checks??{};
  if(!proof||proof.state!=='MATCH'||proof.fileHash!==captured.job.fileHash||!['unit','taxId','address','period'].every(k=>checks[k]==='MATCH'))return {eligible:false as const,reason:'Eu, EVA, ainda não consegui conferir integralmente a identidade no original. Nenhuma retomada foi iniciada.'};
  if(captured.canRecheck){
   const checked=await this.resumeRpc(document,t,'inspect',{p_proof:proof});
   if(!checked?.eligible||JSON.stringify(checked.job)!==JSON.stringify(captured.job)||JSON.stringify(checked.registration)!==JSON.stringify(captured.registration)||checked.customerId!==captured.customerId||checked.unitId!==captured.unitId)return {eligible:false as const,reason:'As fontes mudaram ou a correspondência auditada exige revisão. Atualize antes de retomar.'};
   captured=checked;
  }
  const token=createHash('sha256').update(JSON.stringify({document,org:t.organizationId,actor:t.userId,role:t.roleId,job:captured.job,proof})).digest('hex');
  return {eligible:true as const,token,proof,jobId:captured.job.id};
 }
 async identityResumePreview(document:string,t:TenantContext){
  if(!identityResumeEnabled())return {enabled:false,eligible:false};
  const snapshot=await this.resumeSnapshot(document,t);
  return {enabled:true,eligible:snapshot.eligible,...(snapshot.eligible?{token:snapshot.token,jobId:snapshot.jobId,checks:snapshot.proof.checks,message:'Identidade atual e histórico conferidos. Ao confirmar, a mesma fatura voltará à fila para a primeira leitura OCR, conforme as cotas vigentes.'}:{message:snapshot.reason})};
 }
 async identityResume(document:string,t:TenantContext,b:any){
  await this.identityResumeAccess(t);
  if(!b||Object.keys(b).sort().join(',')!=='acknowledge,reason,requestId,token'||b.acknowledge!==true||typeof b.requestId!=='string'||!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(b.requestId)||typeof b.token!=='string'||!/^[a-f0-9]{64}$/.test(b.token)||typeof b.reason!=='string'||b.reason.trim().length<20||b.reason.length>500)throw new BadRequestException('Confirme a prévia e justifique a retomada.');
  const snapshot=await this.resumeSnapshot(document,t);
  if(!snapshot.eligible||snapshot.token!==b.token)throw new ConflictException('As fontes mudaram ou a leitura não pode ser retomada. Atualize o status.');
  return this.resumeRpc(document,t,'resume',{p_request:b.requestId,p_reason:b.reason.trim(),p_proof:snapshot.proof});
 }
 async enqueue(org:string,document:string,actor:string){
  await this.licenses.requireEntitlement(org,'document_management');
  if(!this.connector.isConfigured()) throw new ServiceUnavailableException('A leitura automática ainda não está habilitada.');
  const {data:doc,error:lookup}=await this.db.getClient().from('documents').select('id').eq('id',document).eq('organization_id',org).maybeSingle();
  if(lookup)throw new ServiceUnavailableException('Não foi possível verificar o documento.');
  if(!doc)throw new NotFoundException('Documento não encontrado.');
  const {data,error}=await this.db.getClient().rpc('enqueue_document_ocr',{p_org:org,p_document:document,p_actor:actor});
  if(['P2091','P2092'].includes(error?.code))throw new ConflictException('EVA: já existe uma fatura desta unidade e competência. Confira a leitura e as versões em Documentos; não inicie outra leitura.');
  if(error)throw new ServiceUnavailableException('Não foi possível enfileirar a leitura. O arquivo original permanece preservado.');
  return this.publicJob(data);
 }
 async assertAutomaticIdentity(org:string,document:string){
  const source=await this.reviewSource(org,document),db=this.db.getClient();
  const canonical=await db.rpc('assert_invoice_month_ocr',{p_org:org,p_document:document});
  if(canonical.error)throw new ConflictException('EVA: fatura repetida ou versão superada. Solicite conferência no backoffice.');
  const [c,u]=await Promise.all([db.from('customers').select('company_name,document').eq('organization_id',org).eq('id',source.doc.customer_id).is('deleted_at',null).maybeSingle(),db.from('consumer_units').select('consumer_unit_number,address,free_market').eq('organization_id',org).eq('customer_id',source.doc.customer_id).eq('id',source.doc.consumer_unit_id).maybeSingle()]);
  if(c.error||u.error||!c.data||!u.data)throw new ConflictException('A identidade cadastral requer conferência.');
  const identity=identityPreview(extractCpflPaulistaLayout(source.raw),{customer:c.data,unit:u.data,referenceMonth:String(source.doc.reference_month).slice(0,7),otherDocumentInPeriod:false});
  if(sourcePreparationEnabled()&&this.sourcePreparation){
   const original=await this.sourcePreparation.invoiceIdentity(org,source.doc.customer_id,source.doc.consumer_unit_id,document,{customerName:c.data.company_name,taxId:c.data.document,unitNumber:u.data.consumer_unit_number,address:u.data.address,month:String(source.doc.reference_month).slice(0,7)});
   if(original&&original.fileHash!==source.doc.file_hash)throw new ConflictException('A fatura mudou durante a conferência da identidade. Atualize as fontes.');
   if(original?.state==='MISMATCH')throw new ConflictException('Eu, EVA, encontrei divergência entre o original da fatura e o cadastro da unidade. Solicite conferência auditada antes do preenchimento.');
   if(original?.state==='MATCH'&&original.fileHash===source.doc.file_hash)return {...identity,originalEvidence:original};
  }
  const required=identity.checks.filter(f=>['taxId','unit','address','period'].includes(f.key));
  if(required.length!==4||required.some(f=>f.comparison!=='EQUAL'||!f.candidates.length||f.candidates.some(v=>!v.pages.length||v.issues.includes('UNVERIFIED_SOURCE'))))throw new ConflictException('EVA: UC, CNPJ, endereço ou competência não conferem com a unidade selecionada. Solicite atendimento; nenhum preenchimento automático foi iniciado.');
  return identity;
 }
 /** Stored ownership is available before extraction; it is never proof of OCR or import. */
 async navigationContext(org:string,document:string){
  if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(document))throw new BadRequestException('Documento inválido.');
  await this.licenses.requireEntitlement(org,'document_management');
  const db=this.db.getClient();
  const d=await db.from('documents').select('id,organization_id,customer_id,consumer_unit_id,reference_month,document_type,file_verified').eq('organization_id',org).eq('id',document).maybeSingle();
  if(d.error)throw new ServiceUnavailableException('Não foi possível consultar o vínculo da fatura.');
  const doc=d.data;
  if(!doc||doc.organization_id!==org||doc.id!==document||doc.document_type!=='INVOICE_DISTRIBUTOR'||doc.file_verified!==true)throw new NotFoundException('Fatura verificada não encontrada nesta organização.');
  const [u,c,j]=await Promise.all([
   db.from('consumer_units').select('id,organization_id,customer_id,status').eq('organization_id',org).eq('customer_id',doc.customer_id).eq('id',doc.consumer_unit_id).is('deleted_at',null).maybeSingle(),
   db.from('customers').select('id,organization_id,status').eq('organization_id',org).eq('id',doc.customer_id).is('deleted_at',null).maybeSingle(),
   db.from('document_ocr_jobs').select('id,state').eq('organization_id',org).eq('document_id',document).maybeSingle(),
  ]);
  if(u.error||c.error||j.error)throw new ServiceUnavailableException('Não foi possível conferir o vínculo e o andamento da fatura.');
  if(!u.data||!c.data||u.data.id!==doc.consumer_unit_id||u.data.organization_id!==org||u.data.customer_id!==doc.customer_id||c.data.id!==doc.customer_id||c.data.organization_id!==org||u.data.status!=='ACTIVE'||c.data.status!=='ACTIVE')throw new ConflictException('O cliente ou a unidade da fatura requer conferência cadastral.');
  const month=String(doc.reference_month).slice(0,7);
  if(!/^(20|21)\d{2}-(0[1-9]|1[0-2])$/.test(month))throw new ConflictException('Competência da fatura inválida.');
  return {documentId:doc.id,customerId:doc.customer_id,unitId:doc.consumer_unit_id,month,ocrState:j.data?.state??'NOT_STARTED',canImport:false as const};
 }
 async status(org:string,document:string){
  await this.licenses.requireEntitlement(org,'document_management');
  const {data,error}=await this.db.getClient().from('document_ocr_jobs').select('id,state,created_at,updated_at,error_code').eq('organization_id',org).eq('document_id',document).maybeSingle();
  if(error)throw new ServiceUnavailableException('Não foi possível consultar a leitura.');
  const intake=data?.state==='SUCCEEDED'?await this.intake(org,document,data.id):null;
  return {enabled:this.connector.isConfigured(),job:data?this.publicJob(data):null,intake,...(identityResumeEnabled()?{identityResumeEnabled:true}:{})};
 }
 async readout(org:string,document:string,query:Record<string,unknown>){
  if(Object.keys(query).some(k=>!['page','section','offset'].includes(k)))throw new BadRequestException('Consulta inválida.');
  const integer=(v:unknown,max:number)=>{if(v===undefined)return 0;if(typeof v!=='string'||!/^\d+$/.test(v)||Number(v)>max)throw new BadRequestException('Página ou posição inválida.');return Number(v);};
  const page=integer(query.page,1000),offset=integer(query.offset,20000000),section=query.section??'fields';
  if(typeof section!=='string'||!['text','fields','pairs','tables'].includes(section))throw new BadRequestException('Seção inválida.');
  await this.licenses.requireEntitlement(org,'document_management');
  const {data,error}=await this.db.getClient().from('document_ocr_jobs').select('id,state').eq('organization_id',org).eq('document_id',document).maybeSingle();
  if(error)throw new ServiceUnavailableException('Não foi possível consultar a leitura.');
  if(!data||data.state!=='SUCCEEDED')throw new NotFoundException('Leitura concluída não encontrada.');
  const verified=await this.verified(org,document,data.id);
  if(!verified)throw new ServiceUnavailableException('A origem da extração requer conferência administrativa.');
  try{return invoiceReadout(verified.raw,{page,offset,section} as ReadoutQuery);}catch{throw new BadRequestException('Página não encontrada.');}
 }
 reviewSource(org:string,document:string){return ocrReadOnce('source:'+org+':'+document,()=>this.loadReviewSource(org,document));}
 private async loadReviewSource(org:string,document:string){
  await this.licenses.requireEntitlement(org,'document_management');
  const r=await this.db.getClient().from('document_ocr_jobs').select('id,state').eq('organization_id',org).eq('document_id',document).maybeSingle();
  if(r.error)throw new ServiceUnavailableException('Não foi possível consultar a extração.');
  if(!r.data||r.data.state!=='SUCCEEDED')throw new NotFoundException('Extração concluída não encontrada.');
  const source=await this.verified(org,document,r.data.id);
  if(!source)throw new ServiceUnavailableException('A origem da extração requer conferência administrativa.');
  return {...source,jobId:r.data.id};
 }
 private async intake(org:string,document:string,job:string){
  const verified=await this.verified(org,document,job);if(!verified)return null;
  const {raw,assessment,doc}=verified;
  const layout=extractCpflPaulistaLayout(raw);
  if(layout.preparation){const registration=await loadDemandRegistration(this.db.getClient(),doc);Object.assign(layout.preparation.demand,{registration,reconciliation:reconcileDemand(layout.preparation.demand,'history' in registration?registration.history:null)});}
  return {...assessment.intake,canImport:false,checkedAt:assessment.checkedAt,elektroAudit:elektroMeasurementAudit(raw,assessment.registration?.customer?.document),layout,electrical:extractElectricalEvidence(raw),gd:extractGdEvidence(raw),readoutSummary:ocrReadoutSummary(raw,assessment.intake.checks)};
 }
 private async verified(org:string,document:string,job:string){
  const db=this.db.getClient();
  const [source,result]=await Promise.all([
   db.from('documents').select('id,organization_id,customer_id,consumer_unit_id,reference_month,file_hash,document_type,file_verified').eq('organization_id',org).eq('id',document).maybeSingle(),
   db.from('document_ocr_results').select('raw_result,file_hash,evidence').eq('organization_id',org).eq('document_id',document).eq('job_id',job).maybeSingle(),
  ]);
  if(source.error||result.error)throw new ServiceUnavailableException('Não foi possível conferir a origem da extração.');
  const doc=source.data;
  if(!doc||!result.data||doc.file_hash!==result.data.file_hash||doc.document_type!=='INVOICE_DISTRIBUTOR'||doc.file_verified!==true)throw new ServiceUnavailableException('A origem da extração requer conferência administrativa.');
  const assessment=result.data.evidence?.assessment;
  if(!assessmentMatchesDocument(assessment,doc))return null;
  if(!['REJECT_AUTOMATION','REVIEW_REQUIRED'].includes(assessment.intake?.decision))return null;
  return {raw:result.data.raw_result,assessment,doc};
 }
 private publicJob(job:any){return {id:job.id,state:job.state,createdAt:job.created_at,updatedAt:job.updated_at,errorCode:job.error_code??null};}
}
