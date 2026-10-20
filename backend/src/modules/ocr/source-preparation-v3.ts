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
 const candidates=valid?sections.filter(s=>s.text.length<=2800&&/^\s*ANEXO\s+I\b/.test(normalized(s.text))&&/ENERGIA\s+CONTRATADA/.test(normalized(s.text))):[];
 if(candidates.length!==1)return {state:'REVIEW' as const,reason:'Anexo contratual único não identificado.',sources:[]};
 const s=candidates[0],t=normalized(s.text),sources=[{page:s.page,sectionHash:s.hash}];
 if(!/^[a-f0-9]{64}$/.test(s.hash)||createHash('sha256').update(s.text).digest('hex')!==s.hash||s.issues.some(i=>i!=='IMAGE_PRESENT'))return {state:'REVIEW' as const,reason:'Fonte ou disposição do anexo requer conferência.',sources};
 const periods=[...t.matchAll(/PERIODO\s+(?:DE\s+)?SUPRIMENTO\s*[:.]?\s*(?:DE\s+)?(\d{2}\/\d{2}\/\d{4})\s*(?:A|ATE|[-–])\s*(\d{2}\/\d{2}\/\d{4})/g)];
 const day=(v:string)=>{const [d,m,y]=v.split('/'),iso=y+'-'+m+'-'+d;const date=new Date(iso+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===iso?iso:null;};
 const start=periods.length===1?day(periods[0][1]):null,end=periods.length===1?day(periods[0][2]):null;
 const [year,monthNumber]=month.split('-').map(Number),last=month+'-'+new Date(Date.UTC(year,monthNumber,0)).getUTCDate();
 if(!start||!end||start>month+'-01'||end<last)return {state:'REVIEW' as const,reason:'Vigência única do anexo não demonstrada para toda a competência.',sources};
 const num=(v:string)=>v.replace(/\./g,'').replace(',','.');
 const volume=[...t.matchAll(/\b(\d{1,4},\d{1,6})\s*MW\s*MEDIO\b/g)].map(m=>num(m[1]));
 // Some annexes print units in the table header. Only one complete row of the
 // explicit energy table, with the same supply period, can supply its MW value.
 const volumeTables=[...t.matchAll(/\bENERGIA\s+CONTRATADA\s+PERIODO\s+MW\s+MEDIO\s+INICIO\s+TERMINO\s+([\s\S]*?)(?=\b\d+\.\s*PRECO\b)/g)];
 for(const table of volumeTables){const row=/^\s*(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{1,4},\d{1,6})\s*$/.exec(table[1]);if(row&&day(row[1])===start&&day(row[2])===end)volume.push(num(row[3]));}
 const pricePattern=new RegExp('01[/.]01[/.]'+month.slice(0,4)+'\\s+(?:(?:A|ATE|[-–])\\s*)?31[/.]12[/.]'+month.slice(0,4)+'\\s+(?:R\\$\\s*)?((?:\\d{1,3}\\.\\d{3}|\\d{1,6})(?:,\\d{1,6})?)(?=\\s|$)','g');
 const prices=[...t.matchAll(pricePattern)];
 const lower=[...t.matchAll(/LIMITE\s+INFERIOR\s*[:=]?\s*(0,\d{1,6}|1,0{1,6})\b/g)],upper=[...t.matchAll(/LIMITE\s+SUPERIOR\s*[:=]?\s*(\d{1,2},\d{1,6})\b/g)];
 const price=prices.length===1?num(prices[0][1]):null;
 let volumeTerms:ReturnType<typeof normalizeContractVolume>|null=null;
 if(volume.length===1&&lower.length===1&&upper.length===1)try{volumeTerms=normalizeContractVolume(month,volume[0],num(lower[0][1]),num(upper[0][1]));}catch{/* ambiguous terms remain pending */}
 const index=/IPCA\s*\/\s*IBGE/.test(t)?'IPCA/IBGE':null;
 return {state:'PROPOSED' as const,period:{start,end},price,priceMode:'BASE' as const,adjustedPrice:null,volumeTerms,index,modulation:/MODULACAO\s*[:=]?\s*FLAT\b/.test(t)?'FLAT':null,sources,
  pending:['Conferir vínculo e vigência do contrato registrado com este anexo.','Comprovar reajustes aplicáveis antes de determinar o preço final.','Conferir tratamento da TRU, compra excedente e tributos conforme cláusulas e fontes.'],automaticFinancialApproval:false};
}

export function sameContractDecimal(a:unknown,b:unknown){
 const value=(v:unknown)=>{const s=String(v);if(!/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/.test(s))return null;const [w,f='']=s.split('.');return BigInt(w)*1000000n+BigInt(f.padEnd(6,'0'));};
 const left=value(a),right=value(b);return left!==null&&right!==null&&left===right;
}

export function contractPartyMatches(sections:ContractTextSection[],taxId:unknown){
 const compact=(v:string)=>v.toUpperCase().replace(/[^A-Z0-9]/g,'');
 const expected=typeof taxId==='string'?compact(taxId):'';
 if(!/^[A-Z0-9]{12}[0-9]{2}$/.test(expected)||sections.length>2000)return false;
 return sections.some(s=>[...s.text.toUpperCase().matchAll(/\b[A-Z0-9]{2}\.?[A-Z0-9]{3}\.?[A-Z0-9]{3}\s*\/?\s*[A-Z0-9]{4}-?[0-9]{2}\b/g)].some(m=>compact(m[0])===expected));
}
