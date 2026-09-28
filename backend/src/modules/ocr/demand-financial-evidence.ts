import type {CpflOperation} from './cpfl-paulista-layout';
import type {ElectricalField} from './electrical-evidence';
const valid=/^(0|[1-9][0-9]{0,11})([.][0-9]{1,9})?$/;
const coefficient=(v:string)=>{const [w,f='']=v.split('.');return BigInt(w)*1000000000n+BigInt(f.padEnd(9,'0'));};
const product=(q:string,r:string)=>{const n=(coefficient(q)*coefficient(r)*100n+500000000000000000n)/1000000000000000000n;const s=n.toString().padStart(3,'0');return s.slice(0,-2)+'.'+s.slice(-2);};
const money=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,11})[.][0-9]{2}$/.test(v);
function confidence(f:ElectricalField|undefined){
 if(!f?.text.trim()||!f.pages?.length||!f.spans?.length||f.issues.some(i=>!['MISSING_CONFIDENCE','CONFIDENCE_BELOW_45','CONFIDENCE_REQUIRES_REVIEW'].includes(i)))return null;
 const n=f.confidence===null&&f.transcription?.state==='VERIFIED_WORDS'&&f.transcription.wordCount>0?f.transcription.confidence:f.confidence;
 return typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1?n:null;
}
/** Read-only financial evidence, outside the signed classification snapshot. Never infer measured demand or tax exemption. */
export function demandFinancialEvidence(rows:CpflOperation[]){
 return rows.filter(r=>r.component==='DEMAND_BILLED'&&r.role==='CHARGE').map(r=>{
  const keys=['unit','quantity','grossRate','amount'],fs=r.fields,confidences=keys.map(k=>confidence(fs[k]));
  const unique=!!r.source&&rows.filter(x=>x.source===r.source).length===1;
  const sourced=unique&&!r.issues.some(i=>['MERGED_OR_DUPLICATE_CELL','UNMAPPED_COLUMN'].includes(i))&&confidences.every(c=>c!==null);
  const minimum=sourced?Math.min(...confidences as number[]):null;
  const quantity=valid.test(fs.quantity?.decimal??'')?fs.quantity.decimal:null,rate=valid.test(fs.grossRate?.decimal??'')?fs.grossRate.decimal:null,amount=money(fs.amount?.decimal)?fs.amount.decimal:null;
  let calculated:string|null=null,difference:string|null=null;
  if(sourced&&fs.unit.text.trim().toLowerCase()==='kw'&&quantity!==null&&rate!==null&&amount!==null){
   try{calculated=product(quantity,rate);difference=(BigInt(calculated.replace('.',''))-BigInt(amount.replace('.',''))).toString();}catch{ /* Unsupported precision stays pending. */ }
  }
  const state=calculated===null?'UNAVAILABLE':difference!=='0'?'DIVERGENT':minimum!==null&&minimum>0.85?'MATCH':'REVIEW_REQUIRED';
  return {source:r.source,quantity,rate,amount,calculated,differenceCents:difference,confidence:minimum,state,canImport:false as const,pages:[...new Set(keys.flatMap(k=>fs[k]?.pages??[]))],message:state==='MATCH'?'Quantidade × tarifa confere exatamente com o valor faturado.':state==='DIVERGENT'?'Quantidade × tarifa diverge do valor faturado. Confira a linha original.':state==='REVIEW_REQUIRED'?'A conta confere, mas a confiança da transcrição exige conferência.':'Origem, unidade ou valores insuficientes para conciliar a parcela.'};
 });
}
