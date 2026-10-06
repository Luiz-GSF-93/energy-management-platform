import {BadRequestException,ConflictException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
import {LicensesService} from '../licenses/services/licenses.service';
import {OcrIdentityService} from './ocr-identity.service';
import {identityReviewDigest} from './ocr-identity-review.service';
import {PERMISSIONS} from '../../common/constants/permissions';
import {MAP_VIEW,MAP_CUSTOMERS,MAP_MANAGE} from '../energy-map/energy-map.validation';
const uuid=(v:any)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
export function addressInput(b:any){
 const keys=['address','city','state','reason','expectedVersion','sourceHash','requestId','checkedPdf','checkedUnit'];
 if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).length!==keys.length||Object.keys(b).some(k=>!keys.includes(k))||
  b.checkedPdf!==true||b.checkedUnit!==true||!uuid(b.requestId)||!Number.isSafeInteger(b.expectedVersion)||b.expectedVersion<0||
  typeof b.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(b.sourceHash))throw new BadRequestException('Confira a origem, o PDF e o vínculo da unidade.');
 for(const [k,min,max] of [['address',5,180],['city',1,60],['reason',20,500]] as const)
  if(typeof b[k]!=='string'||b[k].trim().length<min||b[k].length>max||/[\x00-\x1f;]/.test(b[k]))throw new BadRequestException('Revise o endereço e a justificativa da correção.');
 if(typeof b.state!=='string'||!('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ').includes(b.state.trim().toUpperCase())))throw new BadRequestException('Informe uma UF brasileira.');
 return {...b,address:b.address.trim(),city:b.city.trim(),state:b.state.trim().toUpperCase(),reason:b.reason.trim()};
}
export function addressEligibility(preview:any){
 if(!preview||!Array.isArray(preview.checks)||!preview.registrationAvailable||preview.duplicate||!['cpfl-paulista-a','neoenergia-elektro-verde'].includes(preview.layoutId))return false;
 const sourced=(c:any)=>c&&c.candidates?.length>0&&c.candidates.every((v:any)=>Array.isArray(v.pages)&&v.pages.length>0&&v.pages.every((p:any)=>Number.isSafeInteger(p)&&p>0)&&typeof v.source==='string'&&v.source.length>0&&typeof v.text==='string'&&v.text.trim().length>0&&Array.isArray(v.issues)&&v.issues.every((i:any)=>['MISSING_CONFIDENCE','CONFIDENCE_BELOW_45'].includes(i)));
 // No correction may disguise a document from a different customer/unit.
 if(!['unit','taxId'].every(key=>{const c=preview.checks.find((v:any)=>v.key===key);return sourced(c)&&c.comparison==='EQUAL'&&!['AMBIGUOUS','MISSING','UNSUPPORTED'].includes(c.state);}))return false;
 const a=preview.checks.find((v:any)=>v.key==='address');
 return sourced(a)&&!['AMBIGUOUS','MISSING','UNSUPPORTED'].includes(a.state)&&new Set(a.candidates.map((v:any)=>v.text.trim().replace(/\s+/g,' ').toUpperCase())).size===1;
}
@Injectable()
export class OcrAddressService {
 constructor(private db:SupabaseService,private identity:OcrIdentityService,private config:ConfigService,private licenses:LicensesService){}
 private fail(e:any){if(!e)return;if(e.code==='42501')throw new ForbiddenException('Correção exige vínculo, licença e permissões atuais.');if(['40001','P3161','P3840'].includes(e.code))throw new ConflictException('Cadastro ou origem mudou. Atualize a conferência.');if(['22023','23514','P3841'].includes(e.code))throw new BadRequestException('Revise a origem e os dados; nenhuma correção foi confirmada.');throw new ServiceUnavailableException('Correção indisponível. Preserve a conferência e tente atualizar.');}
 private async access(t:any){
  if(!t?.organizationId||!t.userId||(!['admin_org','gestor','operacional'].includes(t.role)&&t.accessMode!=='platform_operation')||
   ![MAP_VIEW,MAP_CUSTOMERS,MAP_MANAGE,PERMISSIONS.DOCUMENTS_VIEW,PERMISSIONS.ENERGIA_OCR_PROCESS].every(p=>t.permissions?.includes(p))||
   !(this.config.get<string>('ENERGY_MAP_ORGANIZATIONS')||'').split(',').map(v=>v.trim()).includes(t.organizationId))throw new ForbiddenException('Correção disponível ao backoffice autorizado da organização.');
  await this.licenses.requireEntitlement(t.organizationId,'document_management');
  const r=await this.db.getClient().rpc('assert_reviewed_address_actor',{p_org:t.organizationId,p_actor:t.userId});this.fail(r.error);
 }
 private async context(id:string,t:any){
  const c=await this.identity.context(t.organizationId,id),d=c.source.doc;
  const r=await this.db.getClient().from('consumer_units').select('id,customer_id,consumer_unit_number,address,city,state,edit_version').eq('organization_id',t.organizationId).eq('customer_id',d.customer_id).eq('id',d.consumer_unit_id).maybeSingle();this.fail(r.error);
  if(!r.data)throw new ConflictException('Unidade vinculada indisponível.');
  const snapshot={format:'ocr-address-correction-v1',document:d,jobId:c.source.jobId,unit:r.data,registration:c.registration,checks:c.preview.checks};
  return {snapshot,sourceHash:identityReviewDigest(snapshot),eligible:addressEligibility(c.preview)};
 }
 async preview(id:string,t:any){await this.access(t);const c=await this.context(id,t);return {organizationId:t.organizationId,documentId:id,unitId:c.snapshot.unit.id,canCorrect:c.eligible,sourceHash:c.sourceHash,expectedVersion:c.snapshot.unit.edit_version,current:c.snapshot.unit,evidence:c.snapshot.checks.find(v=>v.key==='address')?.candidates??[],message:c.eligible?'Confira o PDF e o vínculo antes de corrigir o cadastro.':'Correção bloqueada: confira CNPJ, UC, origem e duplicidade. CNPJ oculto ou divergente exige resolver a identidade primeiro.'};}
 async save(id:string,t:any,body:unknown){await this.access(t);const input=addressInput(body),db=this.db.getClient();
  const prior=await db.from('ocr_unit_address_corrections').select('document_id,created_by,input,result').eq('organization_id',t.organizationId).eq('request_id',input.requestId).maybeSingle();this.fail(prior.error);
  if(prior.data){if(prior.data.document_id!==id||prior.data.created_by!==t.userId||identityReviewDigest(prior.data.input)!==identityReviewDigest(input))throw new ConflictException('Solicitação já usada por outra correção.');return prior.data.result;}
  const c=await this.context(id,t);if(!c.eligible)throw new BadRequestException('Resolva o vínculo e a origem antes de corrigir o endereço.');
  if(c.sourceHash!==input.sourceHash||c.snapshot.unit.edit_version!==input.expectedVersion)throw new ConflictException('Origem ou cadastro mudou. Atualize a conferência.');
  const r=await db.rpc('save_reviewed_unit_address',{p_org:t.organizationId,p_actor:t.userId,p_document:id,p_input:input,p_snapshot:c.snapshot});this.fail(r.error);return r.data;
 }
}
