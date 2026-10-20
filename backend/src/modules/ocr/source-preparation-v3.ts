import {createHash} from 'node:crypto';
import type {Block} from './cpfl-paulista-layout';

export const SOURCE_PREPARATION_FLAG='EVA_SOURCE_PREPARATION_V3_ENABLED';
export const sourcePreparationEnabled=()=>process.env[SOURCE_PREPARATION_FLAG]==='true';

/** A vertical cell may span an otherwise empty continuation row. Never flatten a
 * horizontal merge, overlap, hidden value or a second tax into the same row. */
export function normalizedTaxBlocks(blocks:Block[]):Block[]{
 return blocks.map(block=>{
  if(block.kind!=='TAX_SUMMARY')return block;
  return {...block,rows:block.rows.map(row=>{
   const merged=row.cells.filter(c=>c.rowSpan>1);
   if(!merged.length||merged.some(c=>c.columnSpan!==1||c.rowSpan>3||!c.value.text.trim()||c.value.issues.some(i=>i!=='MISSING_CONFIDENCE')))return row;
   const end=Math.max(...merged.map(c=>row.index+c.rowSpan));
   for(let index=row.index+1;index<end;index++){
    const continuation=block.rows.filter(r=>r.index===index);
    if(continuation.length!==1||continuation[0].cells.some(c=>c.value.text.trim()||c.rowSpan!==1||c.columnSpan!==1))return row;
   }
   return {...row,cells:row.cells.map(c=>({...c,rowSpan:1}))};
  })};
 });
}

const normalized=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
/** Exact decimal calculation. An upper multiplier of 1.40 is 40% tolerance,
 * not 140% extra. A seasonal option does not create a monthly schedule. */
export function normalizeContractVolume(month:string,mwAverage:string,lowerFactor:string,upperFactor:string){
 if(!/^(20|21)\d{2}-(0[1-9]|1[0-2])$/.test(month))throw Error('Competência inválida.');
 const scaled=(v:string)=>{if(!/^(0|[1-9]\d{0,5})(\.\d{1,6})?$/.test(v))throw Error('Unidade ou fator inválido.');const [w,d='']=v.split('.');return BigInt(w)*1000000n+BigInt(d.padEnd(6,'0'));};
 const mw=scaled(mwAverage),lo=scaled(lowerFactor),hi=scaled(upperFactor);
 if(mw<=0n||lo>1000000n||hi<1000000n||hi>10000000n||lo>hi)throw Error('Flexibilidade inconsistente.');
 const [year,m]=month.split('-').map(Number),hours=new Date(Date.UTC(year,m,0)).getUTCDate()*24;
 const fmt=(n:bigint)=>{const s=n.toString().padStart(7,'0');return (s.slice(0,-6)+'.'+s.slice(-6)).replace(/0+$/,'').replace(/\.$/,'');};
 return {hours,contractedMwh:fmt(mw*BigInt(hours)),minPercent:fmt(lo*100n),maxPercent:fmt(hi*100n),maxTolerancePercent:fmt((hi-1000000n)*100n),volumeBasis:'MONTHLY' as const,originUnit:'MW_AVERAGE' as const};
}

export type ContractTextSection={page:number;text:string;hash:string;issues:string[]};
/** Bounded annex projection. Values retain their document/page/section source.
 * Annual table prices remain BASE; no index, TRU or signature is invented. */
export function contractAnnexEvidence(sections:ContractTextSection[],month:string){
 const valid=sections.length<=2000&&/^(20|21)\d{2}-(0[1-9]|1[0-2])$/.test(month);
 const candidates=valid?sections.filter(s=>s.text.length<=2800&&/ANEXO\s+I\b/.test(normalized(s.text))&&/ENERGIA\s+CONTRATADA/.test(normalized(s.text))):[];
 if(candidates.length!==1)return {state:'REVIEW' as const,reason:'Anexo contratual único não identificado.',sources:[]};
 const s=candidates[0],t=normalized(s.text),sources=[{page:s.page,sectionHash:s.hash}];
 if(!/^[a-f0-9]{64}$/.test(s.hash)||createHash('sha256').update(s.text).digest('hex')!==s.hash||s.issues.some(i=>i!=='IMAGE_PRESENT'))return {state:'REVIEW' as const,reason:'Fonte ou disposição do anexo requer conferência.',sources};
 const num=(v:string)=>v.replace(/\./g,'').replace(',','.');
 const volume=[...t.matchAll(/\b(\d{1,4},\d{1,6})\s*MW\s*MEDIO\b/g)];
 const pricePattern=new RegExp('01[/.]01[/.]'+month.slice(0,4)+'\\s*(?:A|ATE|[-–])\\s*31[/.]12[/.]'+month.slice(0,4)+'\\s+(?:R\\$\\s*)?((?:\\d{1,3}\\.\\d{3}|\\d{1,6})(?:,\\d{1,6})?)(?=\\s|$)','g');
 const prices=[...t.matchAll(pricePattern)];
 const lower=[...t.matchAll(/LIMITE\s+INFERIOR\s*[:=]?\s*(0,\d{1,6}|1,0{1,6})\b/g)],upper=[...t.matchAll(/LIMITE\s+SUPERIOR\s*[:=]?\s*(\d{1,2},\d{1,6})\b/g)];
 const price=prices.length===1?num(prices[0][1]):null;
 let volumeTerms:ReturnType<typeof normalizeContractVolume>|null=null;
 if(volume.length===1&&lower.length===1&&upper.length===1)try{volumeTerms=normalizeContractVolume(month,num(volume[0][1]),num(lower[0][1]),num(upper[0][1]));}catch{/* ambiguous terms remain pending */}
 const index=/IPCA\s*\/\s*IBGE/.test(t)?'IPCA/IBGE':null;
 return {state:'PROPOSED' as const,price,priceMode:'BASE' as const,adjustedPrice:null,volumeTerms,index,modulation:/MODULACAO\s*[:=]?\s*FLAT\b/.test(t)?'FLAT':null,sources,
  pending:['Conferir vínculo e vigência do contrato registrado com este anexo.','Comprovar reajustes aplicáveis antes de determinar o preço final.','Conferir tratamento da TRU, compra excedente e tributos conforme cláusulas e fontes.'],automaticFinancialApproval:false};
}

export function sameContractDecimal(a:unknown,b:unknown){
 const value=(v:unknown)=>{const s=String(v);if(!/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/.test(s))return null;const [w,f='']=s.split('.');return BigInt(w)*1000000n+BigInt(f.padEnd(6,'0'));};
 const left=value(a),right=value(b);return left!==null&&right!==null&&left===right;
}
