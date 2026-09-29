import {elektroEffectiveRate} from './elektro-effective-rate';
import type {CpflOperation} from './cpfl-paulista-layout';
import {tariffProduct} from '../contracts/services/tariff-preview';
/** Exact unit conversion, never round an invoice rate to fit storage precision. */
export function kwhRateToMwh(value:string){
 if(!/^(0|[1-9][0-9]{0,8})([.][0-9]{1,9})?$/.test(value))throw Error('Tarifa fora da precisão suportada.');
 const [whole,fraction='']=value.split('.'),f=fraction.padEnd(3,'0');
 const result=(whole+f.slice(0,3)).replace(/^0+(?=\d)/,'')+(f.slice(3).replace(/0+$/,'')?'.'+f.slice(3).replace(/0+$/,''):'');
 if(!/^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$/.test(result))throw Error('Tarifa fora da precisão suportada.');return result;
}
export function tusdParameterCandidates(rows:CpflOperation[],combined=false){
 return (['PEAK','OFF_PEAK'] as const).map(band=>{
  const found=rows.filter(r=>r.role==='CHARGE'&&r.component==='TUSD_ENERGY'&&r.period===band),r=found[0];
  const blocked=(reason:string)=>({band,ready:false as const,reason,source:r?.source??null,rateKwh:null,rateMwh:null,quantity:null,amount:null});
  if(found.length!==1)return blocked('É necessária uma única linha TUSD deste posto.');
  const taxes=combined?['icmsAmount','pisCofinsAmount']:['icmsAmount','pisAmount','cofinsAmount'];const keys=['description','unit','quantity','grossRate','amount',...taxes];
  if(!r.source||rows.filter(x=>x.source===r.source).length!==1||r.issues.some(i=>['MERGED_OR_DUPLICATE_CELL','UNMAPPED_COLUMN'].includes(i))||keys.some(k=>{const f=r.fields[k];return !f?.text.trim()||!f.pages.length||!((f.confidence!==null&&f.confidence>0.85)||(f.confidence===null&&f.transcription?.state==='VERIFIED_WORDS'&&f.transcription.confidence!==null&&f.transcription.confidence>0.85))||f.issues.some(i=>i!=='MISSING_CONFIDENCE');}))return blocked('Confira a origem, a transcrição e os tributos destacados da linha, incluindo o destaque conjunto quando aplicável.');
  const f=r.fields;if(f.unit.text.trim().toLowerCase()!=='kwh')return blocked('A linha precisa identificar quantidade em kWh.');
  if(!/^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$/.test(f.quantity.decimal??'')||!/^\d+[.]\d{2}$/.test(f.amount.decimal??'')||taxes.some(k=>!/^\d+(?:[.]\d{1,2})?$/.test(f[k].decimal??'')))return blocked('Quantidade, valor ou tributos não identificados com precisão.');
  try{const rate=kwhRateToMwh(f.grossRate.decimal??'');if(tariffProduct(f.quantity.decimal!,rate,true).rounded!==f.amount.decimal){const effective=combined?elektroEffectiveRate(f.quantity.decimal!,f.grossRate.decimal!,f.amount.decimal!):null;if(!effective)return blocked('Quantidade × tarifa não coincide com o valor da operação em centavos.');return {band,ready:true as const,reason:effective.explanation,source:r.source,rateKwh:f.grossRate.decimal,rateMwh:effective.rateMwh,quantity:f.quantity.decimal,amount:f.amount.decimal,rateBasis:effective.basis};}return {band,ready:true as const,reason:'Rascunho com tributos incluídos; aprovação permanece pendente.',source:r.source,rateKwh:f.grossRate.decimal,rateMwh:rate,quantity:f.quantity.decimal,amount:f.amount.decimal};}catch{return blocked('Tarifa não pode ser convertida sem perder precisão.');}
 });
}
