/** Exact arithmetic reference only: equality never classifies billed lines or approves a settlement. */
const decimal=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,11})(?:[.][0-9]{1,6})?$/.test(v);
const scaled=(s:string)=>{const [w,f='']=s.split('.');return BigInt(w)*1000000n+BigInt(f.padEnd(6,'0'));};
const format=(n:bigint)=>{const sign=n<0n?'-':'';const s=(n<0n?-n:n).toString().padStart(7,'0');const f=s.slice(-6).replace(/0+$/,'');return sign+s.slice(0,-6)+(f?'.'+f:'');};
export function reconcileDemand(demand:any,history:any){
 const blocked=(message:string)=>({state:'BLOCKED',canImport:false,contracted:null as string|null,billedTotal:null as string|null,difference:null as string|null,periodId:null as string|null,sources:[] as string[],message});
 if(history?.state!=='COVERED_VALIDATED'||history.periods?.length!==1||history.periods[0].validation!=='VALIDATED')return blocked('A conciliação exige uma vigência validada que cubra toda a competência.');
 const p=history.periods[0];if(p.modality!=='GREEN')return blocked('Modalidade azul exige conciliação separada por posto; as parcelas não serão somadas entre postos.');
 if(!decimal(p.single))return blocked('Demanda contratada inválida para conciliação.');
 const rows=demand?.billed;if(!Array.isArray(rows)||!rows.length||rows.length>100||rows.some(r=>r.state!=='BILLED_UNCLASSIFIED'||r.unit!=='kW'||!decimal(r.decimal)||typeof r.source!=='string'||!r.source.trim())||new Set(rows.map(r=>r.source)).size!==rows.length)return blocked('Parcelas faturadas ausentes, duplicadas ou com origem/unidade ambígua. Confira a leitura.');
 const total=rows.reduce((n:bigint,r:any)=>n+scaled(r.decimal),0n),contracted=scaled(p.single),difference=total-contracted;
 return {state:difference===0n?'MATCH':'DIFFERENCE',canImport:false,contracted:format(contracted),billedTotal:format(total),difference:format(difference),periodId:p.id,sources:rows.map(r=>r.source),message:difference===0n?'A soma das parcelas coincide com a demanda contratada. A coincidência não identifica demanda medida ou não utilizada e não aprova o faturamento.':'A soma das parcelas difere da demanda contratada. Confira o detalhamento da fatura e as condições contratuais; a diferença isolada não comprova cobrança indevida.'};
}
