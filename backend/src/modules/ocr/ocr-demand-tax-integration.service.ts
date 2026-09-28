import {Injectable,BadRequestException,ConflictException,ForbiddenException,ServiceUnavailableException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {OcrCdeTaxIntegrationService} from './ocr-cde-tax-integration.service';
import {OcrSplitDemandIntegrationService} from './ocr-split-demand-integration.service';
import {ocrReviewDigest} from './ocr-review.service';
const codes=['ICMS','PIS','COFINS'];
function identifier(org:string,doc:string,id:string){const h=createHash('sha256').update(JSON.stringify(['ocr-demand-tax-v1',org,doc,id])).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-5'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);}
function sameBasis(b:any,items:any[]){return b?.version===1&&Object.keys(b).length===2&&Array.isArray(b.items)&&b.items.length===items.length&&new Set(b.items.map((i:any)=>i.parameterId)).size===items.length&&b.items.every((i:any)=>Object.keys(i).length===3&&items.some(j=>j.parameterId===i.parameterId&&j.revision===i.revision&&j.operation===i.operation));}
@Injectable()
export class OcrDemandTaxIntegrationService{
 constructor(private db:SupabaseService,private cde:OcrCdeTaxIntegrationService,private demand:OcrSplitDemandIntegrationService){}
 private canWrite(t:TenantContext){return !!t?.organizationId&&!!t.userId&&(['gestor','admin_org'].includes(t.role)||t.accessMode==='platform_operation')&&[P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW,P.ORGANIZATION_CONTRACTS_CREATE,P.ORGANIZATION_CONTRACTS_UPDATE].every(p=>t.permissions?.includes(p));}
 private async context(document:string,t:TenantContext){
  const [a,b]=await Promise.all([this.cde.taxIntegrationSource(document,t),this.demand.taxIntegrationSource(document,t)]);
  const {rows}=a,scope=(p:any)=>p&&p.organization_id===t.organizationId&&p.customer_id===a.a.source.doc.customer_id&&p.consumer_unit_id===a.a.unit.id&&p.scenario==='ACL'&&p.start_date===a.a.period.start&&p.end_date===a.a.period.end;
  const demandBases=['USED','UNUSED'].map(k=>{const c=b.candidates.find(v=>v.classification===k),matches=rows.filter((p:any)=>b.preview.parameterIds.includes(p.id)&&p.component_code==='TUSD_DEMAND_'+k),p=matches[0];const compatible=matches.length===1&&scope(p)&&p.kind==='TARIFF'&&p.status==='APPROVED'&&p.measure==='BRL_KW'&&p.time_band==='ALL'&&p.direction==='DEBIT'&&p.treatment==='GROSS'&&c&&p.amount_text===c.rate&&p.source===a.provenance+' · '+c.source&&Array.isArray(p.embedded_tax_codes)&&p.embedded_tax_codes.length===c.taxCodes.length&&c.taxCodes.every(v=>p.embedded_tax_codes.includes(v))&&Number.isInteger(p.revision)&&p.revision>0;return {p,classification:k,compatible:!!compatible};});
  const ids=[...a.baseItems.map(v=>v.parameterId),...demandBases.map(v=>v.p?.id)],extra=rows.some((p:any)=>p.kind==='TARIFF'&&p.status!=='RETIRED'&&p.start_date<=a.a.period.end&&p.end_date>=a.a.period.start&&!ids.includes(p.id));
  const ready=a.preview.evidenceReady&&a.preview.bases.every(v=>v.approved)&&b.ready&&b.preview.state==='INTEGRATED'&&b.source.jobId===a.a.source.jobId&&b.source.doc.file_hash===a.a.source.doc.file_hash&&b.source.doc.customer_id===a.a.source.doc.customer_id&&b.source.doc.consumer_unit_id===a.a.unit.id&&b.preview.month===a.preview.month&&demandBases.every(v=>v.compatible)&&!extra;
  const declarations=codes.map(code=>{const previous=a.preview.declarations.find(v=>v.code===code)!,old=rows.find((p:any)=>p.id===(previous.replacement?.id??previous.id)),nextId=identifier(t.organizationId,document,old?.id??previous.id),next=rows.find((p:any)=>p.id===nextId);
   const items=[...a.baseItems,...demandBases.map(v=>({parameterId:v.p?.id,revision:v.p?.revision,operation:v.p?.embedded_tax_codes?.includes(code)?'INCLUDE':'EXCLUDE'}))];
   const validOld=scope(old)&&old.kind==='TAX'&&old.component_code===code&&old.measure==='PERCENT'&&old.time_band==='ALL'&&old.treatment==='INCLUDED'&&old.direction==='DEBIT'&&old.amount_text===null&&!old.monetary_source&&!old.embedded_tax_codes?.length&&Number.isInteger(old.revision)&&old.revision>0&&sameBasis(old.tax_basis,a.baseItems)&&(old.source===a.provenance||old.source===a.provenance+' · versão ampliada do parâmetro '+previous.id);
   const validNext=scope(next)&&next.kind==='TAX'&&next.component_code===code&&next.measure==='PERCENT'&&next.time_band==='ALL'&&next.treatment==='INCLUDED'&&next.direction==='DEBIT'&&next.amount_text===null&&!next.monetary_source&&!next.embedded_tax_codes?.length&&next.supersedes_parameter_id===old?.id&&next.source===old?.source+' · versão ampliada do parâmetro '+old?.id&&sameBasis(next.tax_basis,items)&&['DRAFT','APPROVED'].includes(next.status);
   const overlap=rows.some((p:any)=>p.kind==='TAX'&&p.component_code===code&&p.status!=='RETIRED'&&p.start_date<=a.a.period.end&&p.end_date>=a.a.period.start&&p.id!==old?.id&&p.id!==nextId);
   const state=overlap?'CONFLICT':next?(validOld&&validNext?'CREATED':'REVIEW_REQUIRED'):!validOld||old.status!=='APPROVED'?'DECLARATION_REQUIRED':!ready?'BASE_REVIEW_REQUIRED':'READY';
   return {code,state,canCreate:state==='READY'&&this.canWrite(t),previousId:old?.id,nextId,items,proposed:next?{id:next.id,status:next.status,revision:next.revision}:null};
  });
  const token=ocrReviewDigest({source:[a.preview.token,b.preview.token],rows,ready,declarations});
  return {a,b,rows,declarations,preview:{token,month:a.preview.month,evidenceReady:!!ready,declarations:declarations.map(({items,...d})=>({...d,included:items.filter(v=>v.operation==='INCLUDE').length,excluded:items.filter(v=>v.operation==='EXCLUDE').length}))}};
 }
 async preview(document:string,t:TenantContext){return (await this.context(document,t)).preview;}
 async create(document:string,t:TenantContext,body:any){
  if(!this.canWrite(t))throw new ForbiddenException('A integração exige Gestor ou Administrador com permissão de cadastro e alteração de contratos.');
  if(!body||Array.isArray(body)||Object.keys(body).sort().join(',')!=='code,token'||!codes.includes(body.code)||typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token))throw new BadRequestException('Atualize a prévia e escolha o tributo.');
  const x=await this.context(document,t),d=x.declarations.find(v=>v.code===body.code)!;
  if(d.state==='CREATED')return {alreadyCreated:true,parameterId:d.proposed!.id};
  if(body.token!==x.preview.token||!d.canCreate)throw new ConflictException('As evidências ou os parâmetros mudaram. Atualize antes de preparar a versão.');
  const old=x.rows.find((p:any)=>p.id===d.previousId);
  const row={id:d.nextId,supersedes_parameter_id:old.id,organization_id:t.organizationId,customer_id:old.customer_id,consumer_unit_id:old.consumer_unit_id,kind:'TAX',component_code:d.code,label:d.code+' incluído na TUSD, CDE e demanda',scenario:'ACL',time_band:'ALL',measure:'PERCENT',amount_text:null,treatment:'INCLUDED',embedded_tax_codes:[],included_taxes:'',base_rule:'TUSD, CDE e parcelas de demanda conforme tributos embutidos nas tarifas aprovadas. EXCLUDE não declara isenção; evita nova incidência.',tax_basis:{version:1,items:d.items},direction:'DEBIT',source:old.source+' · versão ampliada do parâmetro '+old.id,notes:'Ampliação automática OCR da declaração '+old.id+' (revisão '+old.revision+'). Valores já incluídos; nenhuma cobrança adicional. Prévia '+x.preview.token+'. Job OCR '+x.b.source.jobId+'. Original preservado até aprovação atômica da substituição.',start_date:old.start_date,end_date:old.end_date,unit_context:x.a.bases[0].unit_context,status:'DRAFT',created_by:t.userId,updated_by:t.userId};
  const r=await this.db.getClient().from('calculation_parameters').insert([row]).select('id').single();
  if(r.error?.code==='23505'){const next=await this.context(document,t),saved=next.declarations.find(v=>v.code===body.code)!;if(saved.state==='CREATED')return {alreadyCreated:true,parameterId:saved.proposed!.id};throw new ConflictException('A versão proposta mudou. Atualize a consulta.');}
  if(r.error||!r.data)throw new ServiceUnavailableException('Não foi possível confirmar a versão. Atualize antes de tentar novamente.');
  return {alreadyCreated:false,parameterId:r.data.id};
 }
}
