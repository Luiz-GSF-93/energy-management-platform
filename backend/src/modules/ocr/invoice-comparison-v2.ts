import {documentedSettlementEnabled,documentedTariffPeriod,proportionalTariff,TariffPeriod} from './documented-tariff-period';
import {normalizedTaxBlocks,sourcePreparationEnabled} from './source-preparation-v3';
import {globalModelLayout} from './eva-global-model';
import {selectAutofillLibrary} from './calculation-autofill.model';
import {tariffProduct} from '../contracts/services/tariff-preview';
import {tariffMatrix,InvoiceComparison} from './eva-tariff-workbench.model';
import {decimalFromInvoice} from './electrical-evidence';
import {contractClosingDraftEnabled} from './contract-closing-draft';
const decimal=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,11})(\.\d{1,6})?$/.test(v);
const cents=(v:unknown)=>{if(typeof v!=='string'||! /^-?(0|[1-9][0-9]{0,11})(\.\d{1,2})?$/.test(v))throw Error('Valor monetário sem fonte demonstrada.');const [w,f='']=v.replace('-','').split('.');return (BigInt(w)*100n+BigInt(f.padEnd(2,'0')))*(v.startsWith('-')?-1n:1n);};
const money=(n:bigint)=>{const s=(n<0n?-n:n).toString().padStart(3,'0');return (n<0n?'-':'')+s.slice(0,-2)+'.'+s.slice(-2);};
const clean=(f:any)=>!!f?.text?.trim()&&!f.issues?.some((i:string)=>i!=='MISSING_CONFIDENCE');
const taxKeys=['icmsAmount','pisAmount','cofinsAmount'] as const;
const band=(r:any)=>r.period==='UNSPECIFIED'?'ALL':r.period;
const norm=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
function printedRate(layout:any,key:string){
 const code=({icmsAmount:'ICMS',pisAmount:'PIS',cofinsAmount:'COFINS'} as any)[key],found:any[]=[];
 for(const block of sourcePreparationEnabled()?normalizedTaxBlocks(layout.blocks??[]):layout.blocks??[]){
  if(block.kind!=='TAX_SUMMARY')continue;
  const headers=block.rows.filter((r:any)=>r.cells.some((c:any)=>norm(c.value.text)==='TRIBUTO'));
  if(headers.length!==1)continue;
  const names=headers[0].cells.filter((c:any)=>norm(c.value.text)==='TRIBUTO'),rates=headers[0].cells.filter((c:any)=>/^ALIQUOTA(?: |$)/.test(norm(c.value.text)));
  if(names.length!==1||rates.length!==1)continue;
  for(const row of block.rows.filter((r:any)=>r.index>headers[0].index)){
   const labels=row.cells.filter((c:any)=>c.column===names[0].column),values=row.cells.filter((c:any)=>c.column===rates[0].column);
   if(labels.length!==1||values.length!==1||!(norm(labels[0].value.text)===code||code==='PIS'&&norm(labels[0].value.text)==='PIS PASEP'))continue;
   if([...names,...rates,...labels,...values].some(c=>c.columnSpan!==1||c.rowSpan!==1||!clean(c.value)))continue;
   const value=decimalFromInvoice(values[0].value.text);if(!decimal(value)||Number(value)>100)continue;
   found.push({value,source:block.source+'.row['+row.index+'].column['+rates[0].column+']'});
  }
 }
 return found.length===1?found[0]:null;
}
/** User-requested comparison, not a fiscal reassessment. Never modifies the source invoice. */
export function invoiceComparisonV2(c:any,p:any,libraries:any[]):InvoiceComparison{
 const selection=selectAutofillLibrary(libraries,c.unit,c.month,{taxTreatment:'NET'});let lib=selection.record;
 const layout:ReturnType<typeof globalModelLayout>=c.layout??globalModelLayout(c.source?.raw??{});let period:TariffPeriod|null=null,periodError='';
 if(documentedSettlementEnabled())try{period=documentedTariffPeriod(libraries,c.unit,c.month,layout);if(period)lib=period.segments[0].record;}catch(e){periodError=e instanceof Error?e.message:'Ciclo tarifário sem prova.';}
 const result:InvoiceComparison={method:'SAME_INVOICE_AMOUNTS_V2',amount:null,lines:[],retained:[],taxes:[],observations:['Estimativa comparativa: tarifas ACR da biblioteca; quantidades, impostos em reais, reativos e despesas da fatura preservados. Alíquotas exibidas como leitura, sem reaplicação sobre nova base.'],missing:[],library:lib?{id:lib.id,version:lib.version,source:lib.profile.source,taxTreatment:lib.profile.taxTreatment}:null};
 if('creditSignProof' in layout&&layout.creditSignProof)result.observations.push('Créditos impressos como magnitudes: sinal interpretado pelos rótulos e pelas conciliações exatas de subtotal e total. Transcrição original e confiança preservadas. Fontes: '+layout.creditSignProof.sources.join('; '));
 if('creditSubtotalProof' in layout&&layout.creditSubtotalProof){const proof=layout.creditSubtotalProof;result.observations.push('Subtotal de créditos sem descrição identificado por somas exatas; não adicionado novamente. Fonte: '+proof.source+'; detalhes: '+proof.detailSources.join('; ')+'; subtotal em centavos: '+proof.subtotalCents+'; total final em centavos: '+proof.finalCents+'.'+(proof.billingAdjustmentSources?.length?' Complemento TUSD documentado mantido uma única vez no saldo: '+proof.billingAdjustmentSources.join('; ')+'.':'')+' Texto e confiança originais preservados.');}
 const fail=(message:string)=>{result.missing.push(message);return result;};
 if(periodError)return fail(periodError);
 if(period&&period.segments.length>1)result.observations.push('Tarifa proporcional por dias de vigência: REN1000 art173§2. Consumos totais e impostos da fatura preservados, sem inventar medição diária.');
 for(const excluded of selection.excluded)result.observations.push('Biblioteca '+excluded.id+' v'+excluded.version+' não utilizada: tratamento líquido das tarifas não demonstrado para esta comparação.');
 if(!lib)return fail(contractClosingDraftEnabled()?'Biblioteca ACR compatível não demonstrada para '+c.unit.distributor+' · '+c.unit.tariff_subgroup+' · '+c.unit.tariff_modality+' · '+c.unit.consumption_class+' · '+c.month+'. Confira a classe, a origem líquida e todas as vigências do período faturado; uma mudança de tarifa dentro do período exige evidência por trecho, sem estender uma única tabela ao mês inteiro.':'Biblioteca vigente não encontrada ou enquadramento ambíguo.');
 if(lib.profile.taxTreatment!=='NET')return fail('Confirme em nova versão da biblioteca a origem líquida das tarifas; não somar impostos da fatura a tarifas brutas ou desconhecidas.');
 const rows=layout.operations.filter(r=>['CHARGE','CREDIT','UNKNOWN'].includes(r.role));
 if(layout.reconciliation.state!=='MATCH'||!rows.length)return fail('Rubricas da fatura ainda não conciliadas.');
 try{
  const sources=new Set<string>();let invoice=0n;
  for(const row of rows){
   if(!row.source||sources.has(row.source)||row.role==='UNKNOWN'||row.issues.some(x=>['MERGED_OR_DUPLICATE_CELL','UNMAPPED_COLUMN','UNVERIFIED_SOURCE','UNMAPPED_COMPONENT'].includes(x))||!clean(row.fields.amount))throw Error('Rubrica sem classificação ou fonte íntegra: '+row.source);
   if(['DIVERGENT','DIFFERENCE'].includes(row.arithmetic?.state))throw Error('Quantidade, tarifa e valor divergem: '+row.source);
   sources.add(row.source);const n=cents(row.fields.amount.decimal);if(row.role==='CHARGE'&&n<0n||row.role==='CREDIT'&&n>0n)throw Error('Sinal da rubrica inconsistente: '+row.source);invoice+=n;
  }
  if(invoice!==cents(p.operational?.invoice?.amount))throw Error('As rubricas não conciliam o total da fatura; nenhuma diferença será transformada em despesa.');
  // Printed summary and extracted charge cells must agree. A blank cell is never labelled zero/exempt.
  for(const key of taxKeys){
   const proof=layout.taxReconciliation.checks.find(t=>t.key===key);
   if(!proof||proof.state!=='MATCH_EXTRACTED'||proof.declared===null||proof.extracted!==proof.declared)throw Error('Resumo de impostos não conciliado: '+key);
   let known=0n;const cells:any[]=[];
   for(const row of rows.filter(r=>r.role==='CHARGE')){
    const f=row.fields[key];if(!f?.text?.trim())continue;
    if(!clean(f))throw Error('Imposto sem fonte íntegra: '+row.source);
    const n=cents(f.decimal);if(n<0n||n>cents(row.fields.amount.decimal))throw Error('Imposto incompatível com a rubrica: '+row.source);
    known+=n;cells.push({source:row.source+'.'+key,amount:money(n),rate:key==='icmsAmount'&&clean(row.fields.icmsRate)?row.fields.icmsRate.decimal:null});
   }
   if(known!==cents(proof.declared))throw Error('Impostos conhecidos não conciliam o resumo: '+key);
   result.taxes!.push({code:key,amount:proof.declared,printedRate:printedRate(layout,key),summarySource:proof.summary?.source,cells,partialCells:proof.partial,method:'PRESERVED_INVOICE_AMOUNT',note:'Alíquotas não reaplicadas. Células vazias não declaram isenção ou valor individual zero.'});
  }
  const replaced=new Set(['TE','TUSD_ENERGY','DEMAND_BILLED','DEMAND_UNUSED']);
  let kept=0n;
  for(const row of rows){
   if(replaced.has(row.component)&&row.role==='CREDIT')throw Error('Crédito tarifário exige conciliação específica: '+row.source);
   if(replaced.has(row.component)){
    for(const key of taxKeys){const f=row.fields[key];if(f?.text?.trim()){const n=cents(f.decimal);kept+=n;result.retained.push({kind:'TAX',label:key,amount:money(n),source:row.source+'.'+key});}}
   }else{
    const n=cents(row.fields.amount.decimal);kept+=n;
    result.retained.push({kind:row.component==='REACTIVE_ENERGY'?'REACTIVE':'INVOICE_CHARGE',label:row.fields.description.text,amount:money(n),source:row.source,quantity:row.fields.quantity?.decimal??null,unit:row.fields.unit?.text??null,note:'Valor final da fatura conservado; impostos embutidos não são somados novamente.'});
   }
  }
  const items=lib.profile.items.filter((i:any)=>i.component!=='REACTIVE');
  const expected=tariffMatrix(c.unit.tariff_group,c.unit.tariff_modality).filter(i=>i.component!=='REACTIVE');
  for(const i of expected)if(items.filter((x:any)=>x.component===i.component&&x.band===i.band).length!==1)throw Error('Componente obrigatório da biblioteca: '+i.component+' '+i.band);
  let subtotal=0n;
  for(const i of items){
   if(!decimal(i.value))throw Error('Tarifa inválida na biblioteca.');
   if(items.some((x:any)=>x!==i&&x.component===i.component&&(x.band===i.band||x.band==='ALL'||i.band==='ALL')))throw Error('Postos sobrepostos na biblioteca: '+i.component);
   let quantity:unknown,quantitySource:string;
   if(['TE','TUSD_ENERGY'].includes(i.component)){
    const f=p.fields?.find((f:any)=>f.key===({PEAK:'consumptionPeak',OFF_PEAK:'consumptionOffPeak',INTERMEDIATE:'consumptionIntermediate',ALL:'consumptionTotal'} as any)[i.band]&&f.state==='FILLED');quantity=f?.value;quantitySource=f?.source??'';
    if(!['BRL_KWH','BRL_MWH'].includes(i.measure))throw Error('Unidade da tarifa de energia incompatível.');
   }else if(['TUSD_DEMAND_USED','TUSD_DEMAND_UNUSED'].includes(i.component)){
    if(i.measure!=='BRL_KW')throw Error('Demanda exige R$/kW.');
    const component=i.component==='TUSD_DEMAND_USED'?'DEMAND_BILLED':'DEMAND_UNUSED';
    const billed=rows.filter(r=>r.role==='CHARGE'&&r.component===component&&band(r)===i.band);
    if(i.component==='TUSD_DEMAND_UNUSED'&&!billed.length)continue;
    if(!billed.length)throw Error('Quantidade faturada de demanda não demonstrada: '+i.band);
    let micros=0n;
    for(const row of billed){const f=row.fields.quantity;if(!clean(f)||!decimal(f.decimal)||!clean(row.fields.unit)||row.fields.unit.text.trim().toUpperCase()!=='KW')throw Error('Quantidade/unidade de demanda sem fonte: '+row.source);const [w,d='']=f.decimal.split('.');micros+=BigInt(w)*1000000n+BigInt(d.padEnd(6,'0'));}
    quantity=(micros/1000000n).toString()+'.'+(micros%1000000n).toString().padStart(6,'0');quantitySource=billed.map(r=>r.source).join('; ');
    result.observations.push('Demanda '+i.band+': soma das quantidades faturadas identificadas, sem acrescentar demanda medida ou contratada do cadastro.');
   }else throw Error('Componente não suportado: '+i.component);
   if(!decimal(quantity)||!quantitySource)throw Error('Quantidade e fonte não demonstradas: '+i.component+' '+i.band);
   const weighted=period?proportionalTariff(period,i,quantity):null,amount=weighted?.amount??tariffProduct(quantity,i.value,i.measure==='BRL_MWH').rounded;subtotal+=cents(amount);result.lines.push({...i,...(weighted?{value:weighted.displayRate,proportional:weighted.proof}:{}),quantity,quantitySource,amount,source:weighted?'REN1000 art173§2 · '+weighted.proof.segments.map(s=>'Biblioteca '+s.id+' v'+s.version+' · '+s.days+' dias').join('; '):'Biblioteca '+lib.id+' v'+lib.version});
  }
  for(const row of rows.filter(r=>replaced.has(r.component))){const component=({TE:'TE',TUSD_ENERGY:'TUSD_ENERGY',DEMAND_BILLED:'TUSD_DEMAND_USED',DEMAND_UNUSED:'TUSD_DEMAND_UNUSED'} as any)[row.component];if(!result.lines.some(l=>l.component===component&&l.band===band(row)))throw Error('Rubrica substituída sem tarifa compatível: '+row.source);}
  if(subtotal+kept<0n)throw Error('Comparativo total negativo inconsistente.');
  result.amount=money(subtotal+kept);
  if(c.document?.id&&/^[a-f0-9]{64}$/.test(c.document.file_hash??''))result.invoiceProof={documentId:c.document.id,sourceHash:c.document.file_hash,amount:money(invoice)};
 }catch(error){result.missing.push(error instanceof Error?error.message:'Composição não demonstrada.');}
 return result;
}
