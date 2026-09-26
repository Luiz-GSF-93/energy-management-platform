import {extractGdEvidence} from './gd-evidence';
import { extractElectricalEvidence } from './electrical-evidence';
import { assessmentMatchesDocument } from './invoice-assessment';
import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { SupabaseService } from '../../services/supabase.service';
import { LicensesService } from '../licenses/services/licenses.service';
import { AzureInvoiceConnector } from './azure-invoice.connector';
@Injectable()
export class OcrQueueService {
 constructor(private readonly db:SupabaseService, private readonly licenses:LicensesService, private readonly connector:AzureInvoiceConnector){}
 async enqueue(org:string,document:string,actor:string){
  await this.licenses.requireEntitlement(org,'document_management');
  if(!this.connector.isConfigured()) throw new ServiceUnavailableException('A leitura automática ainda não está habilitada.');
  const {data:doc,error:lookup}=await this.db.getClient().from('documents').select('id').eq('id',document).eq('organization_id',org).maybeSingle();
  if(lookup)throw new ServiceUnavailableException('Não foi possível verificar o documento.');
  if(!doc)throw new NotFoundException('Documento não encontrado.');
  const {data,error}=await this.db.getClient().rpc('enqueue_document_ocr',{p_org:org,p_document:document,p_actor:actor});
  if(error)throw new ServiceUnavailableException('Não foi possível enfileirar a leitura. O arquivo original permanece preservado.');
  return this.publicJob(data);
 }
 async status(org:string,document:string){
  await this.licenses.requireEntitlement(org,'document_management');
  const {data,error}=await this.db.getClient().from('document_ocr_jobs').select('id,state,created_at,updated_at,error_code').eq('organization_id',org).eq('document_id',document).maybeSingle();
  if(error)throw new ServiceUnavailableException('Não foi possível consultar a leitura.');
  const intake=data?.state==='SUCCEEDED'?await this.intake(org,document,data.id):null;
  return {enabled:this.connector.isConfigured(),job:data?this.publicJob(data):null,intake};
 }
 private async intake(org:string,document:string,job:string){
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
  return {...assessment.intake,canImport:false,checkedAt:assessment.checkedAt,electrical:extractElectricalEvidence(result.data.raw_result),gd:extractGdEvidence(result.data.raw_result)};
 }
 private publicJob(job:any){return {id:job.id,state:job.state,createdAt:job.created_at,updatedAt:job.updated_at,errorCode:job.error_code??null};}
}
