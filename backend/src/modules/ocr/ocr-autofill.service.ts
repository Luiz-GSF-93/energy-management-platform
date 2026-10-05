import {Injectable,ForbiddenException,ServiceUnavailableException,BadRequestException,ConflictException} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {LicensesService} from '../licenses/services/licenses.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {OcrQueueService} from './ocr-queue.service';
import {extractCpflPaulistaLayout} from './cpfl-paulista-layout';
import {invoiceAutofill} from './ocr-autofill';
import {ocrReviewDigest} from './ocr-review.service';
import {ocrDraftRole,ocrDraftPermission} from './ocr-draft-access';
import {TariffLibraryService} from '../contracts/services/tariff-library.service';
import {LibraryApplyDto} from '../contracts/dto/tariff-library.dto';
import {validateWriteDto} from '../../common/validation/validate-write-dto';
import {monthPeriod} from '../contracts/services/preparation';
type RelatedDocument={id:string;organization_id:string;customer_id:string;consumer_unit_id:string;reference_month:string|null;original_filename:string;document_type:string;file_verified:boolean;file_hash:string|null;intake_state:string};
@Injectable()
export class OcrAutofillService {
 constructor(private db:SupabaseService,private licenses:LicensesService,private queue:OcrQueueService,private library:TariffLibraryService){}
 async inspect(document:string,t:TenantContext){
  if(!t.userId||!t.organizationId||![P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW].every(p=>t.permissions.includes(p)))throw new ForbiddenException('Acesso aos documentos e contratos necessário.');
  await this.licenses.requireEntitlement(t.organizationId,'document_management');await this.licenses.requireEntitlement(t.organizationId,'free_market_management');
  const source=await this.queue.reviewSource(t.organizationId,document),client=this.db.getClient();
  const [unit,libraries,related]=await Promise.all([client.from('consumer_units').select('*').eq('organization_id',t.organizationId).eq('customer_id',source.doc.customer_id).eq('id',source.doc.consumer_unit_id).maybeSingle(),client.from('tariff_library_versions').select('*').eq('organization_id',t.organizationId).limit(1000),client.from('documents_with_intake').select('id,organization_id,customer_id,consumer_unit_id,reference_month,original_filename,document_type,file_verified,file_hash,intake_state').eq('organization_id',t.organizationId).eq('customer_id',source.doc.customer_id).eq('consumer_unit_id',source.doc.consumer_unit_id).or('reference_month.eq.'+source.doc.reference_month+',document_type.in.(CONTRACT_ENERGY,CONTRACT_CUSD,CONTRACT_CCER,CONTRACT_MANAGEMENT)').order('id').limit(100)]);
  if(unit.error||!unit.data||libraries.error||!Array.isArray(libraries.data)||libraries.data.length>=1000)throw new ServiceUnavailableException('Não foi possível conferir a biblioteca e o vínculo completo da unidade.');
  const relatedRows:RelatedDocument[]=related.data??[];
  if(related.error||!Array.isArray(related.data)||related.data.length>=100||relatedRows.some(d=>d.organization_id!==t.organizationId||d.customer_id!==source.doc.customer_id||d.consumer_unit_id!==source.doc.consumer_unit_id||(!['CONTRACT_ENERGY','CONTRACT_CUSD','CONTRACT_CCER','CONTRACT_MANAGEMENT'].includes(d.document_type)&&d.reference_month!==source.doc.reference_month)))throw new ServiceUnavailableException('Não foi possível conferir as evidências relacionadas completas desta unidade.');
  const month=String(source.doc.reference_month).slice(0,7),filled=invoiceAutofill(extractCpflPaulistaLayout(source.raw),unit.data,month,libraries.data,document,source.doc.file_hash);
  const relatedDocuments=relatedRows.filter(d=>d.id!==document).map(d=>({id:d.id,name:d.original_filename,type:d.document_type,month:String(d.reference_month??'').slice(0,7)||null,fileVerified:d.file_verified===true,intakeState:d.intake_state,source:'Documento '+d.id+' · SHA-256 '+(d.file_hash??'não identificado'),message:d.file_verified===true?'Arquivo disponível como referência. Recebimento e extração não comprovam validação financeira; nenhum valor é presumido pelo nome do arquivo.':'Registro documental encontrado; recebimento verificado ainda não comprovado. Confira o upload antes de usar os dados.'}));
  return {...filled,relatedDocuments,documentId:document,unitId:unit.data.id,month,token:ocrReviewDigest({filled,relatedDocuments,unit:unit.data,actor:t.userId,organization:t.organizationId,document:source.doc,job:source.jobId})};
 }
 async applyLibrary(document:string,t:TenantContext,body:any){
  if(!ocrDraftRole(t)||!ocrDraftPermission(t)||!t.permissions.includes(P.ENERGIA_OCR_PROCESS))throw new ForbiddenException('Preparar rascunhos exige perfil backoffice e permissões OCR e contratos.');
  if(!body||Array.isArray(body)||Object.keys(body).sort().join(',')!=='acknowledged,checkedPdf,libraryId,settings,token'||body.acknowledged!==true||body.checkedPdf!==true||typeof body.token!=='string')throw new BadRequestException('Confira no PDF as alíquotas, as condições e as fontes antes de preparar os rascunhos.');
  const p=await this.inspect(document,t),d=await validateWriteDto(LibraryApplyDto,body.settings),period=monthPeriod(p.month);
  if(!p.library||p.library.id!==body.libraryId||p.token!==body.token||d.consumerUnitId!==p.unitId||d.startDate!==period.start||d.endDate!==period.end||d.scenario!==p.library.scenario)throw new ConflictException('Fonte, vínculo ou biblioteca mudou. Atualize antes de preparar.');
  if(!['0','0.00'].includes(d.cip)||!['0','0.00'].includes(d.other))throw new BadRequestException('Não copiar ajustes ACL para ACR. Confira custos comparativos no formulário de Custos mensais.');
  return this.library.apply(p.library.id,{...d,reason:d.reason+' · Conferência explícita do operador · '+p.source},t.organizationId,t.userId);
 }
}
