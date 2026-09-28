import {electricalField, type ElectricalField} from './electrical-evidence';
const list=(v:any):any[]=>Array.isArray(v)?v:[];
const norm=(v:any)=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
const page=(v:any)=>list(v?.boundingRegions).map(r=>r.pageNumber).filter(Number.isInteger);
const headers=(t:any)=>list(t.cells).filter(c=>c.rowIndex===0).sort((a,b)=>a.columnIndex-b.columnIndex).map(c=>norm(c.content));
const present=(f:ElectricalField)=>!!f.text.trim();
function rational(v:string){const [a,b='']=v.split('.');return {n:BigInt(a+b),d:10n**BigInt(b.length)};}
function compare(a:string,b:string,k:string,total:string){const x=rational(a),y=rational(b),c=rational(k),t=rational(total);const n=(y.n*x.d-x.n*y.d)*c.n*t.d-t.n*y.d*x.d*c.d;return n===0n;}
/** Derived audit of the preserved OCR. No mutations, financial postings or provider resubmissions. */
export function elektroMeasurementAudit(raw:Record<string,any>,registeredTaxId?:string){
 const content=norm(raw.content);if(!/ELEKTRO REDES S A/.test(content)||!content.includes('HORARIA VERDE'))return null;
 const masked=list(raw.keyValuePairs).filter(p=>/^CNPJ\s*[-:]?\s*\*{8}\s*\d{6}\s*$/i.test(String(p.key?.content??''))).map(p=>electricalField(raw,p.key));
 const suffixes=[...new Set(masked.filter(f=>!f.issues.includes('UNVERIFIED_SOURCE')).map(f=>f.text.replace(/\D/g,'')).filter(v=>v.length===6))];
 const registered=String(registeredTaxId??'').replace(/\D/g,'');
 const partialTaxId={state:suffixes.length!==1||registered.length!==14?'REVIEW':registered.endsWith(suffixes[0])?'PARTIAL_MATCH':'MISMATCH',visibleSuffix:suffixes.length===1?suffixes[0]:null,message:'CNPJ parcialmente oculto: comparação somente dos seis dígitos visíveis. Não equivale à validação do CNPJ completo nem aprova o vínculo isoladamente.'};
 const entries:any[]=[];const charges:any[]=[];const issues:string[]=[];const tables=list(raw.tables);
 tables.forEach((t,ti)=>{
  const h=headers(t),cells=list(t.cells);const financial=h[0]==='ITENS DE FATURA'&&h[1]==='UNID'&&h[2]==='QUANT'&&h[4]==='VALOR RS'&&h[5]==='PIS COFINS RS';
  const readings=h[0]==='DESCRICAO'&&h[2]==='LEITURA'&&h[3]==='CONSTANTE'&&h[4]==='AJUSTE'&&h[5]==='CONSUMO DEMANDA';
  if(!financial&&!readings)return;
  const indices=[...new Set<number>(cells.map(c=>c.rowIndex).filter(i=>Number.isInteger(i)&&i>=(readings?2:1)))].sort((a,b)=>a-b);
  for(const row of indices){
   const source='tables['+ti+'].row['+row+']';const rowCells=cells.filter(c=>c.rowIndex===row);
   const get=(column:number,numeric=false)=>{const found=rowCells.filter(c=>c.columnIndex===column);return electricalField(raw,found.length===1&&(found[0].columnSpan??1)===1&&(found[0].rowSpan??1)===1?found[0]:null,numeric);};
   const description=get(0);if(!present(description))continue;
   if(financial){const amount=get(4,true);if(!present(amount)){issues.push(source+': parcela sem valor monetário; não somada.');continue;}charges.push({source,pages:page(t),description,quantity:get(2,true),unit:get(1),amount,icms:get(8,true),pisCofins:get(5,true)});continue;}
   if(!/^(TUSD ENERGIA|CONSUMO REAT|DEMANDA DE DISTRIBUI)/.test(norm(description.text)))continue;
   const fields={previous:get(1,true),current:get(2,true),constant:get(3,true),adjustment:get(4,true),quantity:get(5,true)};
   const names={previous:'leitura anterior',current:'leitura atual',constant:'constante do medidor',quantity:'consumo/demanda de conferência'};
   const required=['previous','current','constant','quantity'] as const;
   const missing=required.filter(k=>!present(fields[k])).map(k=>names[k]);
   const invalid=required.filter(k=>present(fields[k])&&(fields[k].decimal===null||fields[k].issues.includes('UNVERIFIED_SOURCE'))).map(k=>names[k]);
   let state='NOT_VERIFIABLE';let message='';
   if(missing.length)message='A fatura não apresentou os dados necessários para conferir o cálculo desta medição: '+missing.join(', ')+'. Valor faturado preservado; conferência matemática não realizada.';
   else if(invalid.length)message='A extração requer conferência de '+invalid.join(', ')+'. Valor faturado preservado; conferência matemática não realizada.';
   else if(/DEMANDA/.test(norm(description.text)))message='Demanda requer regra de medição específica; a diferença de leituras não foi usada para substituir a demanda faturada.';
   else if(present(fields.adjustment))message='Ajuste de medição informado; conferir sua regra antes de aplicar a diferença de leituras.';
   else if(Number(fields.constant.decimal)<=0||Number(fields.current.decimal)<Number(fields.previous.decimal))message='Constante não positiva ou inversão das leituras; conferir medidor e eventual virada. Valor faturado preservado.';
   else {const match=compare(fields.previous.decimal!,fields.current.decimal!,fields.constant.decimal!,fields.quantity.decimal!);state=match?'MATCH':'DIVERGENT';message=match?'Diferença das leituras multiplicada pela constante coincide com o consumo informado.':'Diferença das leituras multiplicada pela constante diverge do consumo informado. Valor faturado preservado; verificar o demonstrativo.';}
   entries.push({source,pages:page(t),description,fields,state,missing,invalid,message});
  }
 });
 if(!entries.length)issues.push('A fatura não apresentou demonstrativo reconhecido com leituras e constante para conferência.');
 if(!charges.length)issues.push('Tabela financeira não reconhecida; nenhum valor foi somado.');
 // Keep every monetary row: equal labels can represent different tariff posts/tax treatments.
 // Demonstrative rows are evidence only and never enter this sum.
 const cents=charges.map(c=>{const v=c.amount.decimal;if(v===null)return null;const r=rational(v);return r.n*100n%r.d===0n?r.n*100n/r.d:null;});
 const sum=charges.length&&cents.every(c=>c!==null)?cents.reduce<bigint>((a,c)=>a+c!,0n).toString():null;
 return {version:'elektro-measurement-audit-v1',layout:'Neoenergia Elektro — Horária Verde',canImport:false as const,partialTaxId,charges,entries,issues,operationTotalCents:sum,message:'Cobranças extraídas somente da tabela com valores monetários. Demonstrativo de leituras usado para conferência, sem duplicar lançamentos. PIS/Cofins por parcela permanece conjunto quando assim apresentado na fatura.'};
}
