import type {CpflOperation} from './cpfl-paulista-layout';
const sum=(values:(string|null)[])=>{if(values.some(v=>v===null))return null;const cents=values.reduce((n,v)=>{const [a,b='']=v!.split('.');return n+BigInt(a)*100n+BigInt(b.padEnd(2,'0'));},0n);return (cents/100n)+'.'+(cents%100n).toString().padStart(2,'0');};
/** Invoice highlights only; never an additional cost or a tax-rate inference. */
export function cdeTaxHighlights(rows:CpflOperation[]){
 const selected=['PEAK','OFF_PEAK'].map(band=>{const found=rows.filter(r=>r.role==='CHARGE'&&r.component==='CDE_WATER_SCARCITY'&&r.period===band);return found.length===1?found[0]:undefined;});
 const value=(index:number,key:string)=>{const row=selected[index],f=row?.fields[key];if(!row?.source||rows.filter(r=>r.source===row.source).length!==1||row.issues.some(i=>['MERGED_OR_DUPLICATE_CELL','UNMAPPED_COLUMN'].includes(i))||!f?.pages.length||!f.text.trim()||f.issues.some(i=>i!=='MISSING_CONFIDENCE')||!/^\d{1,15}(?:[.]\d{1,2})?$/.test(f.decimal??''))return null;const confidence=f.confidence??(f.transcription?.state==='VERIFIED_WORDS'?f.transcription.confidence:null);return typeof confidence==='number'&&Number.isFinite(confidence)&&confidence>0.85&&confidence<=1?f.decimal:null;};
 const taxes=[['ICMS','icmsAmount'],['PIS','pisAmount'],['COFINS','cofinsAmount']].map(([code,key])=>{const peak=value(0,key),offPeak=value(1,key);return {code,peak,offPeak,total:sum([peak,offPeak])};});
 return {taxes,grossAmount:sum([value(0,'amount'),value(1,'amount')]),includedTaxTotal:sum(taxes.map(t=>t.total)),additionalCharge:'0.00',message:'Destaques das duas linhas CDE, já incluídos no valor bruto. Não somar novamente ao custo e não usar os valores como alíquota. A conciliação final exige declarações vinculadas às bases aprovadas.'};
}
