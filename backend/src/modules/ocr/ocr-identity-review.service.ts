import {elektroIdentityAttestation} from './elektro-identity-confirmation';
import {Injectable,BadRequestException,ConflictException,ServiceUnavailableException,NotFoundException,ForbiddenException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {SupabaseService} from '../../services/supabase.service';
import {OcrIdentityService} from './ocr-identity.service';

import {auditAuthorNames} from '../contracts/services/audit-author-names';

const uuid=(v:any)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export function identityReviewDigest(value:any):string{const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');}
export function identityReviewInput(input:any){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['fieldKey','sourceHash','decision','note','expectedReviewId','requestId','checkedPdf'].includes(k))||!['customer','taxId','unit','address','period','market'].includes(input.fieldKey)||!uuid(input.requestId)||!(input.expectedReviewId===null||uuid(input.expectedReviewId))||typeof input.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(input.sourceHash)||!['CONFIRMED','NEEDS_CORRECTION'].includes(input.decision)||typeof input.note!=='string'||input.note.length>500||input.checkedPdf!==true&&input.checkedPdf!==false)throw new BadRequestException('Dados de conferência inválidos.');const note=input.note.trim();if(input.checkedPdf!==true)throw new BadRequestException('Confirme a conferência do campo no PDF original.');if(note.length<3)throw new BadRequestException('Informe a evidência da conferência ou a correção necessária.');return {...input,note};}
@Injectable()
export class OcrIdentityReviewService{
 constructor(private db:SupabaseService,private identity:OcrIdentityService){}
 private fail(error:any){if(error)throw new ServiceUnavailableException('Não foi possível consultar ou salvar a conferência. Atualize o histórico antes de tentar novamente.');}
 canReview(org:string,t:any){return !!t?.userId&&t.organizationId===org&&(['admin_org','gestor'].includes(t.role)||t.accessMode==='platform_operation');}
 private async context(org:string,document:string){
 const {source,registration,preview}=await this.identity.context(org,document);
 const fields=preview.checks.map(check=>{
 const attestation=elektroIdentityAttestation(preview,check);
 const confirmable=!!attestation||preview.registrationAvailable&&!preview.duplicate&&check.comparison==='EQUAL'&&['MATCH','REVIEW'].includes(check.state)&&check.candidates.length>0&&check.candidates.every(c=>c.pages.length>0&&c.issues.every(issue=>['MISSING_CONFIDENCE','CONFIDENCE_REQUIRES_REVIEW'].includes(issue)));
 const field={...(attestation?{attestation}:{}),key:check.key,label:check.label,unit:'',decimal:attestation?.mode==='REGISTERED_MARKET'?check.expected:check.candidates.map(c=>c.text).join(' | ')||null,state:confirmable?'EXTRACTED_REVIEW':'BLOCKED',description:'Cadastro atual: '+(check.expected??'Não informado')+'. '+check.message+(attestation?' Confirmação humana específica: '+attestation.mode+'. Justifique o vínculo; não aumenta a confiança OCR.':''),source:check.candidates.map(c=>c.source).join('; '),check};
 const snapshot={format:'ocr-identity-review-v1',jobId:source.jobId,registration,document:{id:source.doc.id,organizationId:org,customerId:source.doc.customer_id,unitId:source.doc.consumer_unit_id,month:String(source.doc.reference_month).slice(0,7),fileHash:source.doc.file_hash},field};
 return {field,snapshot,sourceHash:identityReviewDigest(snapshot)};
 });return {...source,fields};
 }
 private table(){return this.db.getClient().from('document_ocr_identity_reviews');}
 private async present(rows:any[],org:string){if(rows.some(r=>r.organization_id!==org||identityReviewDigest(r.source_snapshot)!==r.source_hash))throw new ServiceUnavailableException('A integridade do histórico requer conferência.');const named=await auditAuthorNames(this.db.getClient(),org,rows);return named.map(r=>({id:r.id,fieldKey:r.field_key,sourceHash:r.source_hash,version:r.version,decision:r.decision,confirmationMode:r.source_snapshot.field.attestation?.mode??null,note:r.note,createdAt:r.created_at,author:r.created_by_name??'Autor sem nome cadastrado',value:r.source_snapshot.field.decimal,unit:r.source_snapshot.field.unit}));}
 async list(org:string,document:string){const source=await this.context(org,document);const fields=await Promise.all(source.fields.map(async c=>{const r=await this.table().select('*').eq('organization_id',org).eq('document_id',document).eq('field_key',c.field.key).order('version',{ascending:false}).limit(11);this.fail(r.error);if(!Array.isArray(r.data))this.fail(true);return {...c.field,sourceHash:c.sourceHash,history:await this.present(r.data.slice(0,10),org),hasOlder:r.data.length>10};}));return {canImport:false,fields,message:'Conferência humana de identidade e competência. Preserva a confiança original do OCR e não libera importação, tarifas ou apuração.'};}
 async create(org:string,document:string,t:any,input:any){if(!this.canReview(org,t))throw new ForbiddenException('A conferência de identidade exige Gestor ou Administrador da organização.');const actor=t.userId;const d=identityReviewInput(input);if(!actor?.trim())throw new BadRequestException('Autor obrigatório.');const source=await this.context(org,document);const candidate=source.fields.find(c=>c.field.key===d.fieldKey);if(!candidate)throw new NotFoundException('Campo não disponível para conferência neste layout.');
 const lookup=async()=>{const r=await this.table().select('*').eq('organization_id',org).eq('request_id',d.requestId).maybeSingle();this.fail(r.error);return r.data;};
 const replay=async(r:any)=>{if(r.document_id!==document||r.field_key!==d.fieldKey||r.source_hash!==d.sourceHash||r.created_by!==actor||r.decision!==d.decision||r.note!==d.note)throw new ConflictException('Esta solicitação já pertence a outra conferência.');return {canImport:false,review:(await this.present([r],org))[0]};};
 const existing=await lookup();if(existing)return replay(existing);
 if(candidate.sourceHash!==d.sourceHash)throw new ConflictException('A prévia mudou. Atualize e confira o campo novamente.');
 if(d.decision!=='NEEDS_CORRECTION'&&(candidate.field.state!=='EXTRACTED_REVIEW'||candidate.field.decimal===null))throw new BadRequestException('Campo divergente, ausente, duplicado ou sem origem não pode ser confirmado.');
 if(candidate.field.attestation&&d.decision==='CONFIRMED'&&d.note.length<20)throw new BadRequestException('Descreva a confirmação do vínculo e sua evidência em pelo menos 20 caracteres.');
 const r=await this.table().insert({organization_id:org,document_id:document,job_id:source.jobId,file_hash:source.doc.file_hash,field_key:d.fieldKey,source_hash:candidate.sourceHash,source_snapshot:candidate.snapshot,decision:d.decision,note:d.note,checked_pdf:true,expected_review_id:d.expectedReviewId,request_id:d.requestId,created_by:actor}).select('*').single();
 if(r.error?.code==='23505'){const saved=await lookup();if(saved)return replay(saved);}
 if(r.error?.code==='23514')throw new ConflictException('O cadastro ou a origem mudou. Atualize a conferência antes de salvar.');
 if(r.error?.code==='40001')throw new ConflictException('Outro usuário atualizou a conferência. Atualize o histórico antes de salvar.');this.fail(r.error);return {canImport:false,review:(await this.present([r.data],org))[0]};
 }
}
