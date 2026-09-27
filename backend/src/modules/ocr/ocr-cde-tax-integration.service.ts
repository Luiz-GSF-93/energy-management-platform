import {Injectable,BadRequestException,ConflictException,ForbiddenException,ServiceUnavailableException} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {CalculationParametersService} from '../contracts/services/parameters.service';
import {OcrTusdIntegrationService} from './ocr-tusd-integration.service';
import {OcrCdeIntegrationService} from './ocr-cde-integration.service';
import {ocrReviewDigest} from './ocr-review.service';
import {extractCpflPaulistaLayout} from './cpfl-paulista-layout';
import {componentTaxHighlights} from './cde-tax-highlights';
const codes=['ICMS','PIS','COFINS'];
const sum=(a:string|null,b:string|null)=>{if(a===null||b===null)return null;const cents=(s:string)=>{const [v,d='']=s.split('.');return BigInt(v)*100n+BigInt(d.padEnd(2,'0'));};const n=cents(a)+cents(b);return (n/100n)+'.'+(n%100n).toString().padStart(2,'0');};
function sameItems(basis:any,items:any[]){return basis?.version===1&&Object.keys(basis).every(k=>['version','items'].includes(k))&&Array.isArray(basis.items)&&basis.items.length===items.length&&new Set(basis.items.map((i:any)=>i?.parameterId)).size===items.length&&basis.items.every((i:any)=>i&&Object.keys(i).every(k=>['parameterId','revision','operation'].includes(k))&&items.some(x=>x.parameterId===i.parameterId&&x.revision===i.revision&&i.operation==='INCLUDE'));}
@Injectable()
export class OcrCdeTaxIntegrationService {
 constructor(private db:SupabaseService,private tusd:OcrTusdIntegrationService,private cde:OcrCdeIntegrationService,private parameters:CalculationParametersService){}
 private canUpdate(t:TenantContext){return !!t?.userId&&!!t.organizationId&&(['admin_org','gestor'].includes(t.role)||t.accessMode==='platform_operation')&&t.permissions?.includes(P.ORGANIZATION_CONTRACTS_UPDATE);}
 private async context(document:string,t:TenantContext){
  if(!t?.userId||!t.organizationId||![P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW].every(p=>t.permissions?.includes(p)))throw new ForbiddenException('A conciliação exige acesso aos documentos e parâmetros.');
  // Both sources enforce license, tenant, current identity/consumption reviews and invoice evidence.
  const [a,b]=await Promise.all([this.tusd.taxIntegrationSource(document,t),this.cde.taxIntegrationSource(document,t)]);
  const r=await this.db.getClient().from('calculation_parameters').select('*').eq('organization_id',t.organizationId).eq('consumer_unit_id',a.unit.id).eq('scenario','ACL').range(0,999);
  if(r.error||!Array.isArray(r.data)||r.data.length>=1000)throw new ServiceUnavailableException('Não foi possível consultar as bases tributárias. Atualize a consulta.');
  const rows=r.data,scope=(p:any)=>p&&p.organization_id===t.organizationId&&p.customer_id===a.source.doc.customer_id&&p.consumer_unit_id===a.unit.id&&p.scenario==='ACL'&&p.start_date===a.period.start&&p.end_date===a.period.end;
  const provenance='OCR CPFL · documento '+document+' · SHA-256 '+a.source.doc.file_hash;
  const expected=[...a.ids.map((id,i)=>({id,component:'TUSD_ENERGY',candidate:a.preview.candidates[i]})),...b.ids.map((id,i)=>({id,component:'CDE_WATER_SCARCITY',candidate:b.preview.candidates[i]}))];
  const bases=expected.map(e=>rows.find((p:any)=>p.id===e.id));
  const basesView=expected.map((e,i)=>{const p=bases[i],compatible=scope(p)&&p.kind==='TARIFF'&&p.component_code===e.component&&p.time_band===e.candidate.band&&p.measure==='BRL_MWH'&&p.amount_text===e.candidate.rateMwh&&p.treatment==='GROSS'&&p.direction==='DEBIT'&&p.source===provenance+' · '+e.candidate.source&&codes.every(code=>p.embedded_tax_codes?.includes(code))&&Number.isInteger(p.revision)&&p.revision>0;return {id:e.id,component:e.component,band:e.candidate.band,status:p?.status??'MISSING',revision:p?.revision??null,compatible,approved:compatible&&p.status==='APPROVED'};});
  const sameSource=a.source.jobId===b.source.jobId&&a.source.doc.file_hash===b.source.doc.file_hash&&a.unit.id===b.unit.id&&a.source.doc.customer_id===b.source.doc.customer_id&&a.preview.month===b.preview.month;
  const evidenceReady=sameSource&&a.sourceReady&&b.sourceReady;
  const highlights=componentTaxHighlights(extractCpflPaulistaLayout(a.source.raw).operations,'TUSD_ENERGY');
  const amounts=codes.map(code=>{const tusd=highlights.taxes.find(x=>x.code===code)?.total??null,cde=b.preview.taxHighlights.taxes.find(x=>x.code===code)?.total??null;return {code,tusd,cde,total:sum(tusd,cde)};});
  const baseItems=basesView.map(p=>({parameterId:p.id,revision:p.revision,operation:'INCLUDE'})),allReady=evidenceReady&&basesView.every(p=>p.approved)&&amounts.every(v=>v.total!==null);
  const declarations=codes.map((code,i)=>{
   const id=a.taxIds[i],p=rows.find((p:any)=>p.id===id),overlap=rows.some((p:any)=>p.id!==id&&p.kind==='TAX'&&p.component_code===code&&p.status!=='RETIRED'&&p.start_date<=a.period.end&&p.end_date>=a.period.start);
   const compatible=scope(p)&&p.kind==='TAX'&&p.component_code===code&&p.measure==='PERCENT'&&p.time_band==='ALL'&&p.direction==='DEBIT'&&p.treatment==='INCLUDED'&&p.amount_text===null&&p.source===provenance&&!(p.embedded_tax_codes?.length)&&!p.monetary_source&&Number.isInteger(p.revision)&&p.revision>0;
   const expanded=compatible&&sameItems(p.tax_basis,baseItems),original=compatible&&sameItems(p.tax_basis,baseItems.slice(0,2));
   const state=overlap?'CONFLICT':!p?'MISSING':!compatible||(!expanded&&!original)?'MANUAL_REVIEW':p.status==='RETIRED'?'PRESERVED':expanded?'LINKED':p.status!=='DRAFT'?'PRESERVED':!allReady?'BASE_REVIEW_REQUIRED':'READY';
   const messages:Record<string,string>={CONFLICT:'Há outra declaração deste tributo no período. Revise os parâmetros.',MISSING:'Crie primeiro a declaração TUSD em rascunho.',MANUAL_REVIEW:'A declaração tem alterações ou bases diferentes. Revise manualmente para preservar seu conteúdo.',PRESERVED:'Registro aprovado ou retirado de uso: conteúdo preservado.',LINKED:'TUSD e CDE já vinculadas nesta revisão. A aprovação tributária permanece separada.',BASE_REVIEW_REQUIRED:'Confira as evidências e aprove as quatro bases TUSD e CDE antes de ampliar.',READY:'Disponível para acrescentar as duas bases CDE ao rascunho existente.'};
   return {id,code,status:p?.status??'MISSING',revision:p?.revision??null,state,canUpdate:state==='READY'&&this.canUpdate(t),message:messages[state],linkedBaseCount:p?.tax_basis?.items?.length??0};
  });
  const token=ocrReviewDigest({document,source:[a.preview.token,b.preview.token],rows,amounts,evidenceReady});
  return {a,b,rows,bases,baseItems,provenance,preview:{token,month:a.preview.month,evidenceReady,bases:basesView,amounts,declarations,message:'Ampliação das declarações existentes: TUSD + CDE, sem nova incidência. Cada tributo possui sua própria revisão auditada. Demais componentes da fatura não estão abrangidos.'}};
 }
 async preview(document:string,t:TenantContext){return (await this.context(document,t)).preview;}
 async update(document:string,t:TenantContext,body:any){
  if(!this.canUpdate(t))throw new ForbiddenException('A edição exige Gestor ou Administrador com permissão de alteração de contratos.');
  if(!body||Array.isArray(body)||Object.keys(body).sort().join(',')!=='code,token'||!codes.includes(body.code)||typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token))throw new BadRequestException('Atualize a prévia e selecione o tributo.');
  const x=await this.context(document,t),d=x.preview.declarations.find(v=>v.code===body.code)!;
  if(d.state==='LINKED')return {alreadyUpdated:true,parameterId:d.id,revision:d.revision};
  if(body.token!==x.preview.token||!d.canUpdate)throw new ConflictException('A prévia mudou ou a base está pendente. Atualize a conciliação.');
  const p=x.rows.find((p:any)=>p.id===d.id),amount=x.preview.amounts.find(v=>v.code===body.code)!;
  const justification='Ampliação OCR conferida: acrescentadas CDE ponta e fora ponta às bases TUSD. Destaques já incluídos: TUSD R$ '+amount.tusd+'; CDE R$ '+amount.cde+'; total R$ '+amount.total+'. Não são alíquota nem cobrança adicional. Demais componentes não abrangidos. Prévia '+x.preview.token+'.';
  const notes=p.notes+'\n'+justification,baseRule=p.base_rule+'\nAmpliação: CDE ponta e fora ponta, com tributos já incluídos.';
  if(notes.length>4096||baseRule.length>4096)throw new ConflictException('O histórico textual exige edição manual; nenhuma informação será truncada.');
  // Reuse audited draft editing, with revision compare-and-swap. Never approve a tax here.
  const result=await this.parameters.update(p.id,{consumerUnitId:p.consumer_unit_id,revision:p.revision,kind:p.kind,componentCode:p.component_code,label:p.label===body.code+' incluído na TUSD da fatura'?body.code+' incluído na TUSD e CDE da fatura':p.label,scenario:p.scenario,timeBand:p.time_band,measure:p.measure,amount:null,treatment:p.treatment,embeddedTaxCodes:[],includedTaxes:p.included_taxes,baseRule,direction:p.direction,source:p.source,notes,startDate:p.start_date,endDate:p.end_date,taxBasis:{version:1,items:x.baseItems}},t.organizationId,t.userId);
  return {alreadyUpdated:false,parameterId:result.id,revision:result.revision};
 }
}
