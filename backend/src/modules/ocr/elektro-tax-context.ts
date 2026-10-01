import {classSuccessorId,classReviewedBasis} from './class-parameter-successor';
import {createHash} from 'node:crypto';
import {extractCpflPaulistaLayout} from './cpfl-paulista-layout';
import {reactiveParameterCandidates} from './reactive-parameter-candidates';
import {combinedTaxLayout,operationTaxCodes} from './reviewed-layout-support';
import {ocrReviewDigest} from './ocr-review.service';
const codes=['ICMS','PIS','COFINS'];
const same=(a:any,b:any)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
const basis=(b:any,items:any[])=>b?.version===1&&Object.keys(b).length===2&&Array.isArray(b.items)&&b.items.length===items.length&&new Set(b.items.map((i:any)=>i.parameterId)).size===items.length&&b.items.every((i:any)=>Object.keys(i).length===3&&items.some(j=>j.parameterId===i.parameterId&&j.revision===i.revision&&j.operation===i.operation));
function id(org:string,doc:string,old:string){const h=createHash('sha256').update(JSON.stringify(['ocr-demand-tax-v1',org,doc,old])).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-5'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);}
/** Elektro uses TUSD + reviewed demand + only reactive posts present, never fictitious CDE. */
export function elektroTaxContext(document:string,org:string,a:any,b:any,rows:any[],reactiveIds:string[],canWrite:boolean){
 reactiveIds=reactiveIds.map(id=>classSuccessorId(id,rows));
 const layout=extractCpflPaulistaLayout(a.source.raw),combined=combinedTaxLayout(layout),reactive=reactiveParameterCandidates(layout.operations,layout.layoutId);
 const root=' · documento '+document+' · SHA-256 '+a.source.doc.file_hash;
 const expected:any[]=[...a.preview.candidates.map((c:any,i:number)=>({id:a.ids[i],component:'TUSD_ENERGY',band:c.band,measure:'BRL_MWH',rate:c.rateMwh,codes,source:c.source,prefixes:['OCR fatura','OCR CPFL']})),...b.candidates.map((c:any)=>({id:b.preview.parameterIds.find((id:string)=>rows.some(p=>p.id===id&&p.component_code==='TUSD_DEMAND_'+c.classification)),component:'TUSD_DEMAND_'+c.classification,band:'ALL',measure:'BRL_KW',rate:c.rate,codes:c.taxCodes,source:c.source,prefixes:['OCR CPFL','OCR fatura']})),...reactive.map((c:any)=>({id:reactiveIds.find(id=>rows.some(p=>p.id===id&&p.time_band===c.band)),component:'REACTIVE',band:c.band,measure:'BRL_MWH',rate:c.rateMwh,codes:operationTaxCodes(layout.operations.find(o=>o.source===c.source),true),source:c.source,prefixes:['OCR']}))];
 const scope=(p:any)=>p&&p.organization_id===org&&p.customer_id===a.source.doc.customer_id&&p.consumer_unit_id===a.unit.id&&p.scenario==='ACL'&&p.start_date===a.period.start&&p.end_date===a.period.end;
 const bases=expected.map(e=>rows.find(p=>p.id===e.id));
 const compatible=expected.every((e,i)=>{const p=bases[i];return scope(p)&&p.status==='APPROVED'&&p.kind==='TARIFF'&&p.component_code===e.component&&p.time_band===e.band&&p.measure===e.measure&&p.amount_text===e.rate&&p.treatment==='GROSS'&&p.direction==='DEBIT'&&e.prefixes.some((prefix:string)=>p.source===prefix+root+' · '+e.source)&&Array.isArray(p.embedded_tax_codes)&&same(p.embedded_tax_codes,e.codes)&&Number.isInteger(p.revision)&&p.revision>0;});
 const ids=expected.map(e=>e.id),extra=rows.some(p=>p.kind==='TARIFF'&&p.status!=='RETIRED'&&p.start_date<=a.period.end&&p.end_date>=a.period.start&&!ids.includes(p.id));
 const ready=layout.layoutId==='neoenergia-elektro-verde'&&combined&&a.sourceReady&&b.ready&&b.preview.state==='INTEGRATED'&&a.source.jobId===b.source.jobId&&a.source.doc.file_hash===b.source.doc.file_hash&&a.source.doc.customer_id===b.source.doc.customer_id&&a.unit.id===b.source.doc.consumer_unit_id&&a.preview.month===b.preview.month&&a.ids.length===2&&b.candidates.length===2&&['USED','UNUSED'].every(k=>b.candidates.filter((c:any)=>c.classification===k).length===1)&&reactive.every(c=>c.ready)&&reactiveIds.length===reactive.length&&new Set(ids).size===ids.length&&compatible&&!extra;
 const originalItems=bases.slice(0,2).map(p=>({parameterId:p?.id,revision:p?.revision,operation:'INCLUDE'}));
 const declarations=codes.map((code,i)=>{
  const old=rows.find(p=>p.id===a.taxIds[i]),originalNextId=id(org,document,a.taxIds[i]),originalNext=rows.find(p=>p.id===originalNextId),nextId=classSuccessorId(originalNextId,rows),next=rows.find(p=>p.id===nextId);
  const items=bases.map(p=>({parameterId:p?.id,revision:p?.revision,operation:p?.embedded_tax_codes?.includes(code)?'INCLUDE':'EXCLUDE'}));
  const validOld=scope(old)&&old.kind==='TAX'&&old.component_code===code&&old.measure==='PERCENT'&&old.time_band==='ALL'&&old.treatment==='INCLUDED'&&old.direction==='DEBIT'&&old.amount_text===null&&!old.monetary_source&&!old.embedded_tax_codes?.length&&old.source==='OCR fatura'+root&&basis(classReviewedBasis(old.tax_basis,rows),originalItems);
  const validNext=scope(next)&&next.kind==='TAX'&&next.component_code===code&&next.measure==='PERCENT'&&next.time_band==='ALL'&&next.treatment==='INCLUDED'&&next.direction==='DEBIT'&&next.amount_text===null&&!next.monetary_source&&!next.embedded_tax_codes?.length&&originalNext?.supersedes_parameter_id===old?.id&&next.source===old?.source+' · versão ampliada do parâmetro '+old?.id&&basis(next.tax_basis,items)&&['DRAFT','APPROVED'].includes(next.status);
  const overlap=rows.some(p=>p.kind==='TAX'&&p.component_code===code&&p.status!=='RETIRED'&&p.start_date<=a.period.end&&p.end_date>=a.period.start&&p.id!==old?.id&&p.id!==nextId);
  const state=overlap?'CONFLICT':next?(validOld&&validNext&&ready?'CREATED':'REVIEW_REQUIRED'):!validOld||old.status!=='APPROVED'?'DECLARATION_REQUIRED':!ready?'BASE_REVIEW_REQUIRED':'READY';
  return {code,state,canCreate:state==='READY'&&canWrite,previousId:old?.id,nextId,items,proposed:next?{id:next.id,status:next.status,revision:next.revision}:null};
 });
 const token=ocrReviewDigest({document,source:[a.preview.token,b.preview.token],rows,reactiveIds,ready,declarations});
 return {a:{a,bases},b,rows,declarations,preview:{layout:'ELEKTRO',token,month:a.preview.month,evidenceReady:!!ready,declarations:declarations.map(({items,...d})=>({...d,included:items.filter(v=>v.operation==='INCLUDE').length,excluded:items.filter(v=>v.operation==='EXCLUDE').length}))}};
}

