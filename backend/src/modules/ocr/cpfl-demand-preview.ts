import {demandLineClassification,demandTaxEvidence} from './demand-line-classification';
import {demandTaxReview} from './demand-tax-review';
import type {CpflOperation} from './cpfl-paulista-layout';
import type {MeterReading} from './cpfl-measurements';
const numeric=(s:unknown):s is string=>typeof s==='string'&&/^\d+(?:\.\d+)?$/.test(s);
/** Preserve displayed demand. Never infer measured or unused demand from billed quantities. */
export function cpflDemandPreview(operations:CpflOperation[],meters:MeterReading[]){
 const measured=['PEAK','OFF_PEAK'].map(period=>{
  const rows=meters.filter(r=>r.kind==='ACTIVE_DEMAND'&&r.period===period);
  const row=rows[0],f=row?.fields.reading;
  const valid=rows.length===1&&row.unit==='kW'&&numeric(f?.decimal)&&!row.issues.some(i=>['METER_CELL_AMBIGUOUS','METER_FIELDS_MISSING'].includes(i))&&['quantityKind','period','reading','meter'].every(k=>row.fields[k]&&!row.fields[k].issues.includes('UNVERIFIED_SOURCE'));
  return {period,decimal:valid?f.decimal:null,unit:'kW',state:valid?'DISPLAYED_REVIEW':rows.length?'CONFLICT':'MISSING',sources:rows.map(r=>r.source),message:valid?'Valor apresentado no medidor; pode estar arredondado. Não reconstruído a partir das leituras.':'Demanda do posto ausente ou com origem ambígua.'};
 });
 const billed=operations.filter(r=>r.component==='DEMAND_BILLED'&&r.role==='CHARGE').map(r=>{
  const q=r.fields.quantity,u=r.fields.unit;
  const valid=numeric(q?.decimal)&&u?.text.trim().toLowerCase()==='kw'&&!q.issues.includes('UNVERIFIED_SOURCE')&&!u.issues.includes('UNVERIFIED_SOURCE')&&!r.issues.some(i=>['MERGED_OR_DUPLICATE_CELL','UNMAPPED_COLUMN'].includes(i));
  return {taxReview:demandTaxReview(r),source:r.source,description:r.fields.description?.text??'',period:r.period,decimal:valid?q.decimal:null,unit:'kW',state:valid?'BILLED_UNCLASSIFIED':'CONFLICT',classification:valid?(demandLineClassification(r).message.startsWith('A descrição não identifica')?(demandTaxEvidence(r,operations)??demandLineClassification(r)):demandLineClassification(r)):{kind:'UNCLASSIFIED',basis:'DESCRIPTION',message:'Quantidade ou unidade exige revisão antes de classificar a parcela.'}};
 });
 return {canImport:false,measured,billed,contracted:{decimal:null,message:'Conferir demanda contratada no cadastro vigente; não inferir pela soma das parcelas da fatura.'},unused:{decimal:null,message:'Parcela não utilizada exige identificação explícita e conferência com o contrato vigente.'},message:'Demanda medida e demanda faturada são informações diferentes. Não somar os postos horários nem atribuir parcelas por ordem, valor ou tributação.'};
}
