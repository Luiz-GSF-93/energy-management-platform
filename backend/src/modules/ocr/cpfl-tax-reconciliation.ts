import {decimalFromInvoice,type ElectricalField} from './electrical-evidence';
import type {CpflOperation,Block} from './cpfl-paulista-layout';
const taxes=[['icmsAmount','ICMS'],['pisAmount','PIS'],['cofinsAmount','Cofins']] as const;
const norm=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
const clean=(f?:ElectricalField)=>Boolean(f?.text.trim())&&!f?.issues.some(i=>i!=='MISSING_CONFIDENCE');
function cents(s:string|null|undefined){if(typeof s!=='string'||!/^[-]?[0-9]{1,24}(?:[.][0-9]{1,9})?$/.test(s))return null;const neg=s.startsWith('-'),[a,b='']=s.replace('-','').split('.');if(/[1-9]/.test(b.slice(2)))return null;return (BigInt(a)*100n+BigInt((b+'00').slice(0,2)))*(neg?-1n:1n);}
const decimal=(n:bigint)=>{const abs=n<0n?-n:n;return (n<0n?'-':'')+(abs/100n).toString()+'.'+(abs%100n).toString().padStart(2,'0');};
/** Arithmetic check of extracted CHARGE amounts against the printed summary; no incidence or financial approval. */
export function reconcileCpflTaxes(operations:CpflOperation[],blocks:Block[]){
 const summaries=blocks.filter(b=>b.kind==='TAX_SUMMARY');
 const charges=operations.filter(r=>r.role==='CHARGE');
 const supplierReferenceCount=charges.filter(r=>r.component==='ACL_DISTRIBUTOR_INFORMATION'&&taxes.every(([key])=>!r.fields[key]?.text.trim())).length;
 const rows=charges.filter(r=>!(r.component==='ACL_DISTRIBUTOR_INFORMATION'&&taxes.every(([key])=>!r.fields[key]?.text.trim())));
 const occurrences=new Map<string,number>();operations.forEach(r=>occurrences.set(r.source,(occurrences.get(r.source)??0)+1));
 const checks=taxes.map(([key,label])=>{
  let sum=0n,count=0;
  const sources:string[]=[];
  for(const r of rows){const f=r.fields[key],n=cents(f?.decimal);if(!r.source||occurrences.get(r.source)!==1||r.issues.some(i=>['MERGED_OR_DUPLICATE_CELL','UNMAPPED_COLUMN'].includes(i))||!clean(f)||n===null)continue;sum+=n;count++;sources.push(r.source+'.'+key);}
  const candidates:{value:ElectricalField;source:string}[]=[];let ambiguous=summaries.length>1;
  for(const block of summaries){
   const headers=block.rows.slice(0,3).filter(r=>r.cells.some(c=>norm(c.value.text)==='TRIBUTO'));
   if(headers.length!==1){ambiguous=true;continue;}
   const h=headers[0],names=h.cells.filter(c=>norm(c.value.text)==='TRIBUTO'),amounts=h.cells.filter(c=>norm(c.value.text)==='VALOR R'||norm(c.value.text)==='VALOR');
   if(names.length!==1||amounts.length!==1||names[0].column===amounts[0].column||[names[0],amounts[0]].some(c=>c.columnSpan!==1||c.rowSpan!==1||!clean(c.value))){ambiguous=true;continue;}
   for(const r of block.rows.filter(r=>r.index>h.index)){
    const nameCells=r.cells.filter(c=>c.column===names[0].column),name=nameCells[0];
    if(!name||!(['ICMS','PIS','PIS PASEP','COFINS'].includes(norm(name.value.text))))continue;
    const identified=norm(name.value.text).startsWith('PIS')?'PIS':norm(name.value.text);
    if(identified!==label.toUpperCase())continue;
    const values=r.cells.filter(c=>c.column===amounts[0].column);
    if(nameCells.length!==1||values.length!==1||[name,...values].some(c=>c.columnSpan!==1||c.rowSpan!==1||!clean(c.value))){ambiguous=true;continue;}
    candidates.push({value:values[0].value,source:block.source+'.row['+r.index+'].column['+values[0].column+']'});
   }
  }
  if(candidates.length>1)ambiguous=true;
  const candidate=candidates[0],declared=ambiguous?null:cents(candidate?decimalFromInvoice(candidate.value.text):null);
  const state=ambiguous?'AMBIGUOUS':declared===null||count===0?'MISSING':sum===declared?'MATCH_EXTRACTED':'DIFFERENCE_EXTRACTED';
  return {key,label,state,extracted:count?decimal(sum):null,declared:declared===null?null:decimal(declared),difference:declared===null||!count?null:decimal(sum-declared),count,expected:rows.length,partial:count!==rows.length,sources,summary:!ambiguous&&candidate?candidate:null};
 });
 return {canImport:false as const,supplierReferenceCount,checks,message:'Compara somente os tributos lidos nas cobranças com o resumo impresso. Créditos e descontos são separados. Coincidência de valores não comprova incidência, não transforma campo vazio em zero e não aprova a apuração.'};
}
