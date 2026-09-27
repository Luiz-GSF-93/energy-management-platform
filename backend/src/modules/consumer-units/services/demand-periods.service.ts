import {Injectable,ForbiddenException,BadRequestException,ConflictException,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {SupabaseService} from '../../../services/supabase.service';
import {auditAuthorNames} from '../../contracts/services/audit-author-names';
const uuid=(v:any)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const decimal=(v:any)=>typeof v==='string'&&/^(0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(v);
const date=(v:any)=>typeof v==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export function demandPeriodInput(x:any){if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!['startDate','endDate','modality','singleKw','peakKw','offPeakKw','documentId','reason','supersedesId','requestId'].includes(k))||!date(x.startDate)||!date(x.endDate)||x.endDate<x.startDate||!['GREEN','BLUE'].includes(x.modality)||!uuid(x.documentId)||!uuid(x.requestId)||!(x.supersedesId===null||uuid(x.supersedesId))||typeof x.reason!=='string'||x.reason.trim().length<3||x.reason.length>1000)throw new BadRequestException('Confira datas, documento e justificativa da vigência.');if(x.modality==='GREEN'?(!decimal(x.singleKw)||x.peakKw!==null||x.offPeakKw!==null):(x.singleKw!==null||!decimal(x.peakKw)||!decimal(x.offPeakKw)))throw new BadRequestException('Informe demanda única para verde ou ambos os postos para azul, com até seis casas decimais.');return {...x,reason:x.reason.trim(),documentId:x.documentId.toLowerCase(),requestId:x.requestId.toLowerCase(),supersedesId:x.supersedesId?.toLowerCase()??null};}
@Injectable()
export class DemandPeriodsService{
 constructor(private db:SupabaseService){}
 private table(n:string){return this.db.getClient().from(n);}
 private fail(e:any){if(e)throw new ServiceUnavailableException('Não foi possível consultar o histórico contratual.');}
 private async unit(org:string,id:string){const r=await this.table('consumer_units').select('id,customer_id,organization_id').eq('organization_id',org).eq('id',id).maybeSingle();this.fail(r.error);if(!r.data)throw new NotFoundException('Unidade indisponível.');return r.data;}
 canValidate(t:any){return !!t?.organizationId&&!!t?.userId&&(['admin_org','gestor'].includes(t.role)||t.accessMode==='platform_operation');}
 async list(org:string,id:string){const u=await this.unit(org,id);const [p,d,a]=await Promise.all([this.table('unit_demand_periods').select('*').eq('organization_id',org).eq('consumer_unit_id',id).order('created_at',{ascending:false}).limit(501),this.table('documents').select('id,original_filename').eq('organization_id',org).eq('customer_id',u.customer_id).eq('consumer_unit_id',id).eq('file_verified',true).in('document_type',['CONTRACT_ENERGY','OTHER']).order('id').limit(501),this.table('unit_demand_approvals').select('*').eq('organization_id',org).eq('consumer_unit_id',id).order('created_at').limit(501)]);this.fail(p.error||d.error||a.error);if(!Array.isArray(a.data)||a.data.length>500||!Array.isArray(p.data)||!Array.isArray(d.data)||p.data.length>500||d.data.length>500)throw new ServiceUnavailableException('Histórico extenso; consulta incompleta não será apresentada.');return {periods:await auditAuthorNames(this.db.getClient(),org,p.data),documents:d.data,approvals:await auditAuthorNames(this.db.getClient(),org,a.data),canImport:false};}
 async create(org:string,id:string,actor:string,input:any){const x=demandPeriodInput(input);if(!actor)throw new BadRequestException('Autor obrigatório.');const u=await this.unit(org,id);const payload={organization_id:org,customer_id:u.customer_id,consumer_unit_id:id,start_date:x.startDate,end_date:x.endDate,modality:x.modality,single_kw:x.singleKw,peak_kw:x.peakKw,off_peak_kw:x.offPeakKw,document_id:x.documentId,reason:x.reason,supersedes_id:x.supersedesId,request_id:x.requestId,created_by:actor};
 const lookup=async()=>{const r=await this.table('unit_demand_periods').select('*').eq('organization_id',org).eq('request_id',x.requestId).maybeSingle();this.fail(r.error);return r.data;};
 const replay=(r:any)=>{if(Object.entries(payload).some(([k,v])=>r[k]!==v))throw new ConflictException('Solicitação já utilizada com outros dados.');return {id:r.id,canImport:false};};const old=await lookup();if(old)return replay(old);
 const d=await this.table('documents').select('id,file_hash,original_filename').eq('organization_id',org).eq('customer_id',u.customer_id).eq('consumer_unit_id',id).eq('id',x.documentId).eq('file_verified',true).in('document_type',['CONTRACT_ENERGY','OTHER']).maybeSingle();this.fail(d.error);if(!d.data?.file_hash)throw new BadRequestException('Selecione documento comprobatório verificado desta unidade.');
 const r=await this.table('unit_demand_periods').insert({...payload,document_hash:d.data.file_hash,document_name:d.data.original_filename}).select('id').single();if(r.error?.code==='23505'){const saved=await lookup();if(saved)return replay(saved);}if(['23505','40001','23P01'].includes(r.error?.code))throw new ConflictException('Vigência sobreposta ou versão substituída. Atualize o histórico antes de registrar.');if(r.error?.code==='23514')throw new BadRequestException('Vínculo ou evidência contratual inválida.');this.fail(r.error);return {id:r.data.id,canImport:false};
 }

 async validate(org:string,id:string,periodId:string,t:any,input:any){
  if(!this.canValidate(t)||t.organizationId!==org)throw new ForbiddenException('A validação exige Gestor ou Administrador da organização.');
  if(!uuid(periodId)||!input||Array.isArray(input)||Object.keys(input).some(k=>!['requestId','note','documentConfirmed'].includes(k))||!uuid(input.requestId)||input.documentConfirmed!==true||typeof input.note!=='string'||input.note.trim().length<3||input.note.length>1000)throw new BadRequestException('Confirme a conferência do documento e informe a referência da validação.');
  const u=await this.unit(org,id),payload={organization_id:org,customer_id:u.customer_id,consumer_unit_id:id,period_id:periodId.toLowerCase(),created_by:t.userId,request_id:input.requestId.toLowerCase(),note:input.note.trim()};
  const lookup=async()=>{const r=await this.table('unit_demand_approvals').select('*').eq('organization_id',org).eq('request_id',payload.request_id).maybeSingle();this.fail(r.error);return r.data;};
  const replay=(r:any)=>{if(Object.entries(payload).some(([k,v])=>r[k]!==v))throw new ConflictException('Solicitação já utilizada com outros dados.');return {id:r.id,canImport:false};};
  const old=await lookup();if(old)return replay(old);
  const r=await this.table('unit_demand_approvals').insert(payload).select('id').single();
  if(r.error?.code==='23505'){const saved=await lookup();if(saved)return replay(saved);}
  if(['23505','40001'].includes(r.error?.code))throw new ConflictException('Vigência já validada ou substituída. Atualize o histórico.');
  if(r.error?.code==='23514')throw new BadRequestException('Documento comprobatório ou vínculo da vigência indisponível.');
  this.fail(r.error);return {id:r.data.id,canImport:false};
 }
}
