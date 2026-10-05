import {decimalFromInvoice} from './electrical-evidence';
import {monthPeriod} from '../contracts/services/preparation';
import {tusdParameterCandidates} from './tusd-parameter-candidates';
import {cdeParameterCandidates} from './cde-parameter-candidates';
import {reactiveParameterCandidates} from './reactive-parameter-candidates';
import {cipCostCandidate} from './cip-cost-candidate';
import type {extractCpflPaulistaLayout} from './cpfl-paulista-layout';
type Layout=ReturnType<typeof extractCpflPaulistaLayout>;
const normalized=(v:unknown)=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const classKey=(v:unknown)=>normalized(v)==='COMERCIAL'?'COMMERCIAL':normalized(v);
/** Preparation only: no human attestation, model-generated amount, ledger write or approval. */
export function invoiceAutofill(layout:Layout,unit:any,month:string,libraries:any[],document:string,fileHash:string){
 const period=monthPeriod(month),source=`OCR · documento ${document} · SHA-256 ${fileHash}`;
 const measurements:Record<string,string>={};
 const measurementReviews:Record<string,{state:string;sources:string[];reason:string}>={};
 const consumptionKeys:Record<string,string>={consumptionPeakKwh:'consumptionPeak',consumptionOffPeakKwh:'consumptionOffPeak',consumptionTotalKwh:'consumptionTotal'};
 for(const f of layout.preparation?.values??[]){const key=consumptionKeys[f.key];if(!key)continue;
  if(f.unit==='kWh'&&f.state==='EXTRACTED_REVIEW'&&f.decimal!==null)measurements[key]=f.decimal;
  const rows=layout.operations.filter(r=>(f.sources??[]).includes(r.source));
  const fields=rows.flatMap(r=>[r.fields.quantity,r.fields.unit]).filter(Boolean);
  const reliable=fields.length>0&&fields.every(v=>!v!.issues.includes('UNVERIFIED_SOURCE')&&(v!.confidence!=null?v!.confidence>0.85:v!.transcription?.state==='VERIFIED_WORDS'&&(v!.transcription?.confidence??0)>0.85));
  measurementReviews[key]={state:f.state==='CONFLICT'?'CONFLICT':f.decimal===null?'MISSING':reliable?'CHECK':'REVIEW_REQUIRED',sources:f.sources??[],reason:f.state==='CONFLICT'?'Valores divergentes na leitura.':reliable?'Valor transcrito com fonte; conferir OK.':'Confiança da transcrição insuficiente; confira o valor no PDF.'};
 }
 const superseded=new Set(libraries.map(l=>l.previous_id).filter(Boolean));
 const matched=libraries.filter(l=>{const p=l.profile;return !superseded.has(l.id)&&p&&p.startDate<=period.start&&p.endDate>=period.end&&normalized(p.distributor)===normalized(unit.distributor)&&normalized(p.group)===normalized(unit.tariff_group)&&normalized(p.subgroup)===normalized(unit.tariff_subgroup)&&p.modality===unit.tariff_modality&&(p.consumptionClass==='GENERAL'||classKey(p.consumptionClass)===classKey(unit.consumption_class));});
 const library=matched.length===1?matched[0]:null;
 const taxes=layout.blocks.filter(b=>b.kind==='TAX_SUMMARY').flatMap(b=>{
  const headers=b.rows.filter(r=>r.cells.some(c=>normalized(c.value.text)==='TRIBUTO'));
  if(headers.length!==1)return [];
  const h=headers[0],column=(label:string)=>{const a=h.cells.filter(c=>normalized(c.value.text).startsWith(label));return a.length===1&&a[0].rowSpan===1&&a[0].columnSpan===1?a[0].column:null;};
  const name=column('TRIBUTO'),rate=column('ALIQUOTA');if(name===null||rate===null||name===rate)return [];
  return b.rows.filter(r=>r.index>h.index).flatMap(r=>{
   const names=r.cells.filter(c=>c.column===name),rates=r.cells.filter(c=>c.column===rate);
   if(names.length!==1||rates.length!==1||[...names,...rates].some(c=>c.rowSpan!==1||c.columnSpan!==1||c.value.issues.some(i=>i!=='MISSING_CONFIDENCE')))return [];
   const n=normalized(names[0].value.text),code=n==='PISPASEP'?'PIS':n;if(!['ICMS','PIS','COFINS'].includes(code))return [];
   const value=decimalFromInvoice(rates[0].value.text);if(value===null||!/^\d+(?:\.\d{1,6})?$/.test(value)||Number(value)>=100)return [];
   return [{code,rate:value,source:b.source+`.row[${r.index}].column[${rate}]`,state:'REVIEW_REQUIRED',message:'Alíquota transcrita do resumo. A incidência e a base por rubrica devem ser conferidas; não aplicar novamente às tarifas ACL brutas.'}];
  });
 });
 const uniqueTaxes=taxes.filter(t=>taxes.filter(x=>x.code===t.code).length===1);
 const tariffs=[...tusdParameterCandidates(layout.operations).map(t=>({...t,component:'TUSD_ENERGY'})),...cdeParameterCandidates(layout.operations).map(t=>({...t,component:'CDE_WATER_SCARCITY'})),...reactiveParameterCandidates(layout.operations).map(t=>({...t,component:'REACTIVE'}))];
 for(const candidate of reactiveParameterCandidates(layout.operations,layout.layoutId))if(candidate.ready&&candidate.quantity){const key=candidate.band==='PEAK'?'reactiveBilledPeakKwh':'reactiveBilledOffPeakKwh';measurements[key]=candidate.quantity;measurementReviews[key]={state:'CHECK',sources:candidate.source?[candidate.source]:[],reason:'Quantidade e tarifa do reativo conciliadas com o valor da linha; conferir OK.'};}
 const cip=cipCostCandidate(layout.operations,month);
 const costs=cip.ready?[{label:'Contribuição de iluminação pública (CIP)',amount:cip.amount,scenario:'ACL',category:'OTHER',effect:'COST',taxTreatment:'INCLUDED',source}]:[];
 return {version:1,source,measurements,measurementReviews,tariffs,taxes:uniqueTaxes,costs,library:library?{id:library.id,version:library.version,source:library.profile.source,start:library.profile.startDate,end:library.profile.endDate,scenario:unit.free_market===true?'ACR':'ACL',items:library.profile.items}:null,
  libraryState:library?'MATCHED':matched.length>1?'AMBIGUOUS':'MISSING',
  message:'Preenchimentos preparados automaticamente para conferência. Valores ausentes permanecem vazios. Tributos da fatura não comprovam sua incidência no cenário comparativo. Dados financeiros existentes são preservados.'};
}
