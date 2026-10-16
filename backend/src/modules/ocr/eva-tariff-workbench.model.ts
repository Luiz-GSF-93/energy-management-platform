import {tariffProduct} from '../contracts/services/tariff-preview';
import {extractCpflPaulistaLayout} from './cpfl-paulista-layout';
import {selectAutofillLibrary} from './calculation-autofill.model';

export const tariffMatrix=(group:string,modality:string)=>{
 const bands=modality==='WHITE'?['PEAK','INTERMEDIATE','OFF_PEAK']:['GREEN','BLUE'].includes(modality)?['PEAK','OFF_PEAK']:['ALL'];
 return [...bands.flatMap(band=>['TE','TUSD_ENERGY'].map(component=>({component,band,measure:'BRL_KWH'}))),
  ...(group==='A'?(modality==='BLUE'?['PEAK','OFF_PEAK']:['ALL']).map(band=>({component:'TUSD_DEMAND_USED',band,measure:'BRL_KW'})):[]),
  ...(group==='A'?['PEAK','OFF_PEAK'].map(band=>({component:'REACTIVE',band,measure:'BRL_KWH'})):[])];
};
const dec=(x:unknown):x is string=>typeof x==='string'&&/^(0|[1-9][0-9]{0,11})(\.\d{1,6})?$/.test(x);
const cents=(x:unknown)=>{if(typeof x!=='string'||!/^[-]?(0|[1-9][0-9]{0,11})(\.\d{1,2})?$/.test(x))throw Error('Parcela monetária sem conciliação');const [w,f='']=x.replace('-','').split('.');return (BigInt(w)*100n+BigInt(f.padEnd(2,'0')))*(x.startsWith('-')?-1n:1n)};
const money=(x:bigint)=>{const s=(x<0n?-x:x).toString().padStart(3,'0');return (x<0n?'-':'')+s.slice(0,-2)+'.'+s.slice(-2)};
const value=(p:any,k:string)=>p.fields?.find((f:any)=>f.key===k&&f.state==='FILLED')?.value;
const layoutOf=(c:any)=>extractCpflPaulistaLayout(c.source?.raw??{});

/** Existing OCR evidence only. No provider call, confidence promotion or model training. */
export function tariffCandidates(c:any){
 const layout=layoutOf(c),profile=c.unit,source='Fatura '+c.document.id+' · SHA-256 '+c.document.file_hash;
 const candidates:any[]=[];
 for(const key of ['distributor','tariff_group','tariff_subgroup','tariff_modality','consumption_class'])candidates.push({key,value:profile[key]??null,origin:'REGISTRATION',source:'Cadastro '+profile.id,confidence:null,checks:['Não é confiança OCR; cadastro usado como sugestão.']});
 for(const r of layout.operations){
  const component=({TE:'TE',TUSD_ENERGY:'TUSD_ENERGY',DEMAND_BILLED:'TUSD_DEMAND_USED',DEMAND_UNUSED:'TUSD_DEMAND_UNUSED',REACTIVE_ENERGY:'REACTIVE'} as Record<string,string>)[r.component];
  const f=dec(r.fields.aneelRate?.decimal)?r.fields.aneelRate:r.fields.grossRate,unit=r.fields.unit?.text?.trim().toUpperCase();
  const measure=unit==='MWH'?'BRL_MWH':unit==='KWH'?'BRL_KWH':unit==='KW'?'BRL_KW':unit==='KVARH'?'BRL_KVARH':null;
  if(!component||!f||!dec(f.decimal)||!measure)continue;
  candidates.push({key:component+':'+(r.period==='UNSPECIFIED'?'ALL':r.period),value:f.decimal,component,band:r.period==='UNSPECIFIED'?'ALL':r.period,measure,origin:'OCR',source:source+' · '+r.source,pages:f.pages,confidence:typeof f.confidence==='number'&&f.confidence>=0&&f.confidence<=1?f.confidence:null,checks:[...(f.issues??[]),'Preço lido da fatura; pode incluir tributos. Não comprova tarifa homologada líquida.']});
 }
 return {formatVersion:1,documentId:c.document.id,sourceHash:c.document.file_hash,layout:layout.layoutId,candidates,profile:{distributor:profile.distributor,group:profile.tariff_group,subgroup:profile.tariff_subgroup,modality:profile.tariff_modality,consumptionClass:profile.consumption_class},message:'Proposta de extração. Campos ausentes não viram zero; corrija e confira antes de registrar uma versão.'};
}

export type InvoiceComparison={method:'SAME_INVOICE_QUANTITIES_AND_CHARGES_V1';amount:string|null;lines:any[];retained:any[];observations:string[];missing:string[];library:any};
/** Explicit user-requested counterfactual; never labels a measured quantity as legally billed. */
export function invoiceComparison(c:any,p:any,libraries:any[]):InvoiceComparison{
 const selected=selectAutofillLibrary(libraries,c.unit,c.month),lib=selected.record;
 const r:InvoiceComparison={method:'SAME_INVOICE_QUANTITIES_AND_CHARGES_V1',amount:null,lines:[],retained:[],observations:['Estimativa comparativa: mesmas quantidades e valores de impostos/despesas identificados na fatura; não reproduz faturamento ACR certificado.'],missing:[],library:lib?{id:lib.id,version:lib.version,source:lib.profile.source}:null};
 if(!lib){r.missing.push('Biblioteca vigente não encontrada ou enquadramento ambíguo.');return r;}
 const layout=layoutOf(c),items=lib.profile.items;
 if(layout.reconciliation?.state!=='MATCH'){r.missing.push('A fatura exige conciliação do total antes de conservar despesas.');return r;}
 // NET is mandatory for this method: charges from the original bill must not be added to gross prices.
 if(lib.profile.taxTreatment!=='NET'){r.missing.push('Informe em nova versão da biblioteca a origem líquida das tarifas; preço bruto ou desconhecido não recebe os mesmos impostos novamente.');return r;}
 const expected=tariffMatrix(c.unit.tariff_group,c.unit.tariff_modality).filter(i=>i.component!=='REACTIVE');
 for(const item of expected)if(items.filter((x:any)=>x.component===item.component&&x.band===item.band).length!==1)r.missing.push('Componente obrigatório da biblioteca: '+item.component+' '+item.band+'.');
 let subtotal=0n;
 for(const i of items){
  if(i.component==='TUSD_DEMAND_UNUSED')continue; // Measured-demand comparison does not invent an unused share.
  let quantity:unknown;
  if(['TE','TUSD_ENERGY'].includes(i.component))quantity=value(p,({PEAK:'consumptionPeak',OFF_PEAK:'consumptionOffPeak',INTERMEDIATE:'consumptionIntermediate',ALL:'consumptionTotal'} as any)[i.band]);
  else if(i.component==='TUSD_DEMAND_USED'){
   quantity=c.billed?.ACR?.[i.band==='PEAK'?'peak':i.band==='OFF_PEAK'?'offPeak':'single'];
   if(!dec(quantity)){quantity=value(p,i.band==='PEAK'?'demandPeak':i.band==='OFF_PEAK'?'demandOffPeak':'demandSingle');r.observations.push('Demanda '+i.band+': leitura medida utilizada como hipótese comparativa, sem declarar demanda faturável regulatória.');}
  }else if(i.component==='REACTIVE')quantity=value(p,i.band==='PEAK'?'reactiveBilledPeakKwh':i.band==='OFF_PEAK'?'reactiveBilledOffPeakKwh':'reactiveTotal');
  else {r.missing.push('Rubrica não suportada nesta metodologia: '+i.component);continue;}
  if(i.component==='REACTIVE'&&!dec(quantity))continue;
  const energy=['TE','TUSD_ENERGY'].includes(i.component),compatible=energy?['BRL_KWH','BRL_MWH'].includes(i.measure):i.component==='TUSD_DEMAND_USED'?i.measure==='BRL_KW':i.component==='REACTIVE'&&(i.measure==='BRL_KVARH'||['BRL_KWH','BRL_MWH'].includes(i.measure));
  if(!dec(quantity)||!dec(i.value)||!compatible){r.missing.push('Quantidade/unidade incompatível: '+i.component+' '+i.band);continue;}
  if(items.some((x:any)=>x!==i&&x.component===i.component&&(x.band===i.band||x.band==='ALL'||i.band==='ALL'))){r.missing.push('Postos tarifários sobrepostos: '+i.component);continue;}
  // Reactive quantity has its own unit; do not equate kvarh with kWh implicitly.
  if(i.component==='REACTIVE'&&i.band==='ALL'&&i.measure!=='BRL_KVARH'||i.component==='REACTIVE'&&i.band!=='ALL'&&i.measure==='BRL_KVARH'){r.missing.push('Unidade do reativo não corresponde à quantidade da leitura: '+i.band);continue;}
  const amount=tariffProduct(quantity,i.value,i.measure==='BRL_MWH').rounded;subtotal+=cents(amount);r.lines.push({...i,quantity,amount,source:'Biblioteca '+lib.id+' v'+lib.version});
 }
 for(const band of ['PEAK','OFF_PEAK','ALL']){const quantity=value(p,band==='PEAK'?'reactiveBilledPeakKwh':band==='OFF_PEAK'?'reactiveBilledOffPeakKwh':'reactiveTotal');if(dec(quantity)&&Number(quantity)>0&&!r.lines.some(i=>i.component==='REACTIVE'&&i.band===band))r.missing.push('Tarifa/unidade do reativo ausente: '+band);}
 // Remove energy/network rows from the reconciled invoice and retain everything else exactly once.
 // Every removed row must have all its embedded tax amounts reconciled; unknown rows fail closed.
 const replaced=new Set(['TE','TUSD_ENERGY','DEMAND_BILLED','DEMAND_UNUSED','REACTIVE_ENERGY']);
 const charges=layout.operations.filter(x=>['CHARGE','CREDIT','UNKNOWN'].includes(x.role));
 let original=0n,keep=0n;
 try{for(const row of charges){
  if(row.fields.amount?.issues?.some(x=>x!=='MISSING_CONFIDENCE'))throw Error('Valor da rubrica sem fonte íntegra: '+row.source);
  const amount=cents(row.fields.amount?.decimal);original+=row.role==='CREDIT'?-abs(amount):amount;
  if(row.role==='UNKNOWN')throw Error('Rubrica não classificada: '+row.source);
  if(replaced.has(row.component)&&row.role==='CHARGE'){
   const target=({TE:'TE',TUSD_ENERGY:'TUSD_ENERGY',DEMAND_BILLED:'TUSD_DEMAND_USED',DEMAND_UNUSED:'TUSD_DEMAND_USED',REACTIVE_ENERGY:'REACTIVE'} as Record<string,string>)[row.component];
   if(!r.lines.some(l=>l.component===target))throw Error('Rubrica da fatura sem quantidade/tarifa comparativa: '+row.component);
   if(row.component==='DEMAND_UNUSED')r.observations.push('Demanda não utilizada da fatura substituída pela hipótese de demanda medida; não se presume parcela não utilizada no comparativo.');
   let taxes=0n;for(const key of ['icmsAmount','pisAmount','cofinsAmount']){const f=row.fields[key];if(!f?.decimal||f.issues?.some(x=>x!=='MISSING_CONFIDENCE'))throw Error('Impostos da rubrica sem decomposição: '+row.source);taxes+=cents(f.decimal);}
   if(taxes<0n||taxes>amount)throw Error('Impostos excedem a rubrica');keep+=taxes;r.retained.push({label:'Impostos conservados da rubrica',amount:money(taxes),source:row.source});
  }else{const signed=row.role==='CREDIT'?-abs(amount):amount;keep+=signed;r.retained.push({label:row.fields.description?.text??row.component,amount:money(signed),source:row.source});}
 }
 if(!charges.length||original!==cents(p.operational?.invoice?.amount))throw Error('Rubricas/descontos não reconciliam o total; não presumir diferença como despesa.');
 if(subtotal+keep<0n)throw Error('Comparativo negativo inconsistente');
 if(!r.missing.length)r.amount=money(subtotal+keep);
 }catch(e){r.missing.push(e instanceof Error?e.message:'Composição não demonstrada.');}
 return r;
}
const abs=(n:bigint)=>n<0n?-n:n;

/** Minimum provider confidence on every essential field, never the mean or a human-inflated score. */
export function modelConfidence(raw:any,threshold=0.9){
 const l=extractCpflPaulistaLayout(raw),fields:any[]=[];
 for(const name of ['customerTaxId','unit','reference','classification']){
  const found=l.fields.filter(f=>f.name===name);fields.push({key:name,confidence:found.length===1?found[0].value.confidence:null,source:found.length===1?found[0].source:null});
 }
 for(const row of l.operations.filter(r=>r.role==='CHARGE'))for(const key of ['description','amount',...(['TE','TUSD_ENERGY','DEMAND_BILLED','DEMAND_UNUSED','REACTIVE_ENERGY'].includes(row.component)?['quantity','aneelRate']:[])]){
  const f=row.fields[key];fields.push({key:row.source+'.'+key,confidence:f?.confidence??null,source:row.source,issues:f?.issues??[]});
 }
 const scores=fields.map(f=>f.confidence),minimum=scores.length&&scores.every(v=>typeof v==='number'&&v>=0&&v<=1)?Math.min(...scores):null;
 const consistent=!!l.layoutId&&l.reconciliation.state==='MATCH'&&l.operations.length>0&&!l.operations.some(r=>r.role==='UNKNOWN'||r.issues.some(x=>['MERGED_OR_DUPLICATE_CELL','UNMAPPED_COLUMN','UNMAPPED_COMPONENT','UNVERIFIED_SOURCE'].includes(x))||r.arithmetic?.state==='DIFFERENCE')&&fields.every(f=>!(f.issues??[]).some((x:string)=>x!=='MISSING_CONFIDENCE'));
 return {threshold,score:minimum,state:minimum!==null&&minimum>=threshold&&consistent?'READY_FOR_REVIEW':'NEEDS_REVISION',consistent,fields,layout:l.layoutId,aiScore:null,message:'Mínimo de confiança OCR por campo essencial. Consistência é verificação separada. Correção humana não aumenta o score; sem leitura suficiente, envie nova versão legível. Nenhuma repetição paga automática.'};
}
