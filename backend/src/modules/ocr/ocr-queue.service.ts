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
  if(!this.connector.isConfigured())return {enabled:false,job:null};
  const {data,error}=await this.db.getClient().from('document_ocr_jobs').select('id,state,created_at,updated_at,error_code').eq('organization_id',org).eq('document_id',document).maybeSingle();
  if(error)throw new ServiceUnavailableException('Não foi possível consultar a leitura.');
  return {enabled:this.connector.isConfigured(),job:data?this.publicJob(data):null};
 }
 private publicJob(job:any){return {id:job.id,state:job.state,createdAt:job.created_at,updatedAt:job.updated_at,errorCode:job.error_code??null};}
}
