import {extractElektroLayout} from './elektro-layout';
import {reconcileCpflTaxes} from './cpfl-tax-reconciliation';
import {cpflPreparationPreview} from './cpfl-preparation-preview';
import {extractCpflMeasurements,cpflReference} from './cpfl-measurements';
import {reconcileCpflOperations} from './cpfl-reconciliation';
import {electricalField, decimalFromInvoice, classifyElectricalLine, type ElectricalField} from './electrical-evidence';
import {invoiceLayoutLibrary} from './layout-library';
const list=(v:any):any[]=>Array.isArray(v)?v:[];
const text=(v:any):string=>typeof v==='string'?v:'';
const norm=(v:any)=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
type Field=ElectricalField;
type NamedField={name:string;label:string;value:Field;source:string};
export type Block={kind:string;label:string;source:string;rows:{index:number;cells:{column:number;columnSpan:number;rowSpan:number;value:Field}[]}[]};
export type CpflOperation={source:string;row:number;component:string;period:string;role:'CHARGE'|'CREDIT'|'TOTAL'|'INFORMATION'|'UNKNOWN';fields:Record<string,Field>;issues:string[];arithmetic:{state:string;differenceCents:string|null}};
const headers:Record<string,string>={
 'DESCRICAO DA OPERACAO':'description','UNID MED':'unit','QUANT FATURADA':'quantity','TARIFA ANEEL':'aneelRate','TARIFA COM TRIBUTOS R':'grossRate','TARIFA COM TRIBUTOS':'grossRate','VALOR TOTAL DA OPERACAO R':'amount','VALOR TOTAL DA OPERACAO':'amount','BASE CALC ICMS':'icmsBase','ALIQ ICMS':'icmsRate','ICMS':'icmsAmount'
};
export const cpflColumns=[['description','Componente'],['unit','Unid.'],['quantity','Quantidade faturada'],['aneelRate','Tarifa ANEEL'],['grossRate','Tarifa com tributos'],['amount','Valor da operação'],['icmsBase','Base ICMS'],['icmsRate','Alíquota ICMS (%)'],['icmsAmount','ICMS (R$)'],['pisAmount','PIS (R$)'],['cofinsAmount','COFINS (R$)']];
function header(value:any){const n=norm(value);if(/^DESCRICAO DA OPERACAO(?: N [0-9]+)?$/.test(n))return 'description';if(/^PIS(?: [0-9 ]+)?$/.test(n))return 'pisAmount';if(/^COFINS(?: [0-9 ]+)?$/.test(n))return 'cofinsAmount';return headers[n];}
function classify(description:string,unit:string){
 const d=norm(description),base=classifyElectricalLine(description);let component:string=base.component,role:CpflOperation['role']='CHARGE';
 if(/^(SUBTOTAL|TOTAL DISTRIBUIDORA|TOTAL A PAGAR)$/.test(d))return {...base,component:d.replace(/ /g,'_'),role:'TOTAL' as const};
 if(/^(DESCONTOS INFORMATIVOS|AJUSTE SUBVENCAO)/.test(d))return {...base,component:'INFORMATIVE_ADJUSTMENT',role:'INFORMATION' as const};
 if(d==='DEVOLUCAO')return {...base,component:'ADJUSTMENTS_SUBTOTAL',role:'TOTAL' as const};
 if(/^(DEVOL|DEVOLUCAO)/.test(d)){component='REFUND';role='CREDIT';}
 else if(/^DESC ENERGIA ACL/.test(d)){component='ACL_ENERGY_DISCOUNT';role='CREDIT';}
 else if(/^CREDITO SUBVENCAO/.test(d)){component='SUBSIDY_CREDIT';role='CREDIT';}
 else if(/^SUBVENCAO TARIFARIA/.test(d))component='TARIFF_SUBSIDY';
 else if(/^(CONTRIBUICAO CUSTEIO IP|CIP|COSIP)\b/.test(d))component='PUBLIC_LIGHTING';
 else if(/^CDE ESCASSEZ HIDRICA/.test(d))component='CDE_WATER_SCARCITY';
 else if(/^USD CONSUMO REATIVO/.test(d))component='REACTIVE_ENERGY';
 else if(/^USO SIST DISTR/.test(d)&&norm(unit)==='KW')component='DEMAND_BILLED';
 else if(/^TUSD ENC CONS/.test(d))component='TUSD_ENERGY';
 else if(/^ENERGIA ACL/.test(d))component='ACL_DISTRIBUTOR_INFORMATION';
 if(component==='OTHER')role='UNKNOWN';
 return {component,period:base.period,role};
}
function decimal(v:string){const [a,b='']=v.split('.');return {n:BigInt(a+b),scale:10n**BigInt(b.length)};}
function arithmetic(f:Record<string,Field>){
 if(!f.quantity?.decimal||!f.grossRate?.decimal||!f.amount?.decimal)return {state:'NOT_VERIFIABLE',differenceCents:null};
 const q=decimal(f.quantity.decimal),t=decimal(f.grossRate.decimal),a=decimal(f.amount.decimal);const divisor=q.scale*t.scale;
 const numerator=q.n*t.n*100n,abs=numerator<0n?-numerator:numerator;const rounded=((abs+divisor/2n)/divisor)*(numerator<0n?-1n:1n);
 if((a.n*100n)%a.scale!==0n)return {state:'AMOUNT_PRECISION_REVIEW',differenceCents:null};
 const diff=rounded-a.n*100n/a.scale;return {state:diff>=-1n&&diff<=1n?'MATCH_WITHIN_ONE_CENT':'DIVERGENT',differenceCents:diff.toString()};
}
const aliases:Record<string,[string,string]>={
 'NUMERO DA UC':['unit','Número da UC'],'UNIDADE CONSUMIDORA':['unit','Número da UC'],
 'RAZAO SOCIAL':['customer','Razão social'],'CNPJ DO CLIENTE':['customerTaxId','CNPJ do cliente'],
 'ENDERECO DA INSTALACAO':['serviceAddress','Endereço da unidade'],'ENDERECO DA UNIDADE CONSUMIDORA':['serviceAddress','Endereço da unidade'],
 'CLASSIFICACAO':['classification','Classificação tarifária'],'TIPO DE FORNECIMENTO':['supply','Tipo de fornecimento'],
 'REF MES ANO':['reference','Referência mês/ano'],'REFERENCIA MES ANO':['reference','Referência mês/ano'],
 'VENCIMENTO':['dueDate','Vencimento'],'LEITURA ATUAL':['currentReading','Leitura atual'],'LEITURA ANTERIOR':['previousReading','Leitura anterior'],'N DE DIAS':['billingDays','Dias faturados'],
 'NOTA FISCAL N':['invoiceNumber','Número da nota fiscal'],'NUMERO DA NOTA FISCAL':['invoiceNumber','Número da nota fiscal'],'NOTA FISCAL':['invoiceNumber','Número da nota fiscal'],'SERIE':['series','Série'],'DATA DE EMISSAO':['issueDate','Data de emissão'],
 'NUMERO DO MEDIDOR':['meter','Número do medidor']
};
const generic:Record<string,[string,string]>={CustomerName:['customer','Razão social'],CustomerTaxId:['customerTaxId','CNPJ do cliente'],ServiceAddress:['serviceAddress','Endereço da unidade'],InvoiceId:['documentReference','Referência reconhecida — pode ser boleto'],InvoiceDate:['issueDate','Data de emissão'],DueDate:['dueDate','Vencimento']};
/** Derived read-only projection of preserved OCR. Never overwrites the historical assessment. */
function extractCpflOnly(raw:any){
 const fields:NamedField[]=[],operations:CpflOperation[]=[],blocks:Block[]=[],issues:string[]=[];
 const docs=list(raw?.documents),tables=list(raw?.tables),pairs=list(raw?.keyValuePairs);
 const issuer=norm(docs[0]?.fields?.VendorName?.content);
 const firstPageLines=list(list(raw?.pages).find(p=>p.pageNumber===1)?.lines).map(l=>norm(l.content));
 const issuerNames=['CPFL PAULISTA','COMPANHIA PAULISTA DE FORCA E LUZ'];
 const issuerMatched=issuerNames.some(n=>issuer===n||firstPageLines.some(l=>l===n||l.startsWith(n+' ')));
 const classificationLines=list(list(raw?.pages).find(p=>p.pageNumber===1)?.lines).filter(l=>/^CLASSIFICACAO /.test(norm(l.content)));
 const classifications=pairs.filter(p=>norm(p?.key?.content)==='CLASSIFICACAO').map(p=>norm(p?.value?.content));
 const classificationEvidence=[...classifications,...classificationLines.map(l=>norm(l.content).replace(/^CLASSIFICACAO /,''))];
 const groupA=classificationEvidence.some(v=>/\bA[1-4]\b|\bAS\b/.test(v));
 let measurements:ReturnType<typeof extractCpflMeasurements>|null=null;
 const result=()=>({taxReconciliation:reconcileCpflTaxes(operations,blocks),preparation:issuerMatched&&groupA&&docs.length===1?cpflPreparationPreview(operations,measurements?.meterReadings??[]):null,measurements,version:'cpfl-paulista-a@1.2.0',layoutId:issuerMatched&&groupA?'cpfl-paulista-a':null,name:issuerMatched&&groupA?'CPFL Paulista · Grupo A':'Layout ainda não identificado',status:'IN_HOMOLOGATION',canImport:false,library:invoiceLayoutLibrary,columns:cpflColumns,fields,operations,blocks,issues:[...new Set(issues)],coverage:[
  {label:'Identificação e período',mapped:['customer','customerTaxId','serviceAddress','unit','reference','dueDate','currentReading','previousReading'].filter(k=>fields.some(f=>f.name===k&&f.value.text.trim())).length,expected:8},
  {label:'Dados fiscais',mapped:['invoiceNumber','series','issueDate'].filter(k=>fields.some(f=>f.name===k&&f.value.text.trim())).length,expected:3},
  {label:'Colunas da tabela de operações',mapped:cpflColumns.filter(([k])=>operations.some(r=>r.fields[k]?.text.trim())).length,expected:11}
 ],reconciliation:reconcileCpflOperations(operations),financialReconciliation:'REVIEW_REQUIRED',reviewMessage:'Cobertura de campos não é precisão comprovada. Layout em homologação; não alimenta o cálculo até conferir identidade, fonte, confiança, totais e regras de importação.'});
 if(docs.length!==1){issues.push('INVOICE_COUNT_NOT_ONE');return result();}
 if(!issuerMatched){issues.push('DISTRIBUTOR_NOT_IDENTIFIED');return result();}
 if(!groupA){issues.push('TARIFF_GROUP_NOT_IDENTIFIED_AS_A');return result();}
 const add=(name:string,label:string,input:any,source:string)=>{
  const content=text(input?.content).trim();
  if(['dueDate','currentReading','previousReading','issueDate'].includes(name)&&!/^\d{2}\/\d{2}\/\d{4}$/.test(content))return;
  fields.push({name,label,value:electricalField(raw,input),source});
 };
 // Customer CNPJ must lie inside the UC/customer block on page 1, before the explicit NF label.
 const page1=(v:any)=>list(v?.boundingRegions).some(r=>r.pageNumber===1);
 const offset=(v:any)=>list(v?.spans).length?Math.min(...list(v.spans).map(s=>s.offset)):Infinity;
 const uc=pairs.filter(p=>norm(p?.key?.content)==='NUMERO DA UC'&&page1(p.key));
 const nf=pairs.filter(p=>norm(p?.key?.content)==='NOTA FISCAL N'&&page1(p.key));
 if(uc.length===1&&nf.length===1){
  const start=offset(uc[0].key),end=offset(nf[0].key);
  pairs.forEach((p,i)=>{if(norm(p?.key?.content)==='CNPJ'&&page1(p.key)&&offset(p.key)>start&&offset(p.key)<end)add('customerTaxId','CNPJ do cliente — bloco da UC',{...p.value,confidence:p.confidence},'keyValuePairs['+i+']');});
  const lines=list(raw.pages).find(p=>p.pageNumber===1)?.lines;
  const within=list(lines).filter(l=>offset(l)>start&&offset(l)<end);
  const address=within.filter(l=>/^(R |RUA |AV |AVENIDA |ALAMEDA |ESTRADA |RODOVIA |VL |VILA |BAIRRO |[0-9]{5}[- ][0-9]{3})/.test(norm(l.content)));
  if(address.some(l=>/^[0-9]{5}[- ][0-9]{3}/.test(norm(l.content)))&&address.length>=2)add('serviceAddress','Endereço no bloco da UC',{content:address.map(l=>l.content).join('\n'),spans:address.flatMap(l=>list(l.spans)),boundingRegions:[{pageNumber:1}]},'pages[0].customerBlock.address');
 }

 const pageLines=list(list(raw.pages).find(p=>p.pageNumber===1)?.lines);
 const fiscalLines=pageLines.filter(l=>/^NOTA FISCAL N /.test(norm(l.content)));
 const ucLabels=pageLines.filter(l=>norm(l.content)==='NUMERO DA UC');
 const part=(line:any,value:string,position?:number)=>{
  const spans=list(line.spans),at=position??text(line.content).indexOf(value);
  if(spans.length!==1||at<0||text(raw.content).slice(spans[0].offset,spans[0].offset+spans[0].length)!==line.content)return null;
  return {content:value,spans:[{offset:spans[0].offset+at,length:value.length}],boundingRegions:[{pageNumber:1}]};
 };
 if(fiscalLines.length===1&&ucLabels.length===1&&offset(ucLabels[0])<offset(fiscalLines[0])){
  const fiscal=fiscalLines[0],match=text(fiscal.content).match(/NOTA\s+FISCAL\s+N[º°o]?\s*(\d+)\s*[-–]\s*S[ÉE]RIE\s+(\d+)/i);
  if(match){for(const [name,label,value] of [['invoiceNumber','Número da nota fiscal',match[1]],['series','Série',match[2]]]){const input=part(fiscal,value,name==='series'?text(fiscal.content).indexOf(match[0])+match[0].lastIndexOf(value):undefined);if(input)add(name,label,input,'pages[0].customerBlock.'+name);}}
  const within=pageLines.filter(l=>offset(l)>offset(ucLabels[0])&&offset(l)<offset(fiscal));
  const taxLines=within.filter(l=>/\bCNPJ\s*:/i.test(text(l.content)));
  if(taxLines.length===1){const match=text(taxLines[0].content).match(/CNPJ\s*:\s*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/i);if(match){const input=part(taxLines[0],match[1]);if(input)add('customerTaxId','CNPJ do cliente — bloco da UC',input,'pages[0].customerBlock.customerTaxId');}}
  const start=within.findIndex(l=>/^(R |RUA |AV |AVENIDA |RDV |RODOVIA |ESTRADA )/.test(norm(l.content)));
  const end=within.findIndex((l,i)=>i>=start&&/^\d{5}-?\d{3}$/.test(text(l.content).trim()));
  if(start>=0&&end>=start&&end-start<=3&&!fields.some(f=>f.name==='serviceAddress')){const address=within.slice(start,end+1).filter(l=>! /^(PROXIMA LEITURA|LEITURA ATUAL|LEITURA ANTERIOR|N DE DIAS)\b/.test(norm(l.content)));add('serviceAddress','Endereço no bloco da UC',{content:address.map(l=>l.content).join('\n'),spans:address.flatMap(l=>list(l.spans)),boundingRegions:[{pageNumber:1}]},'pages[0].customerBlock.address');}
 }
 if(!classifications.length)classificationLines.forEach((line,i)=>add('classification','Classificação tarifária — texto da fatura',{...line,boundingRegions:[{pageNumber:1}]},'pages[0].classification['+i+']'));
 for(const [k,[name,label]] of Object.entries(generic)){if(docs[0].fields?.[k])add(name,label,docs[0].fields[k],'documents[0].'+k);}
 pairs.slice(0,500).forEach((p,i)=>{const alias=aliases[norm(p?.key?.content)];if(alias)add(...alias,{...p.value,confidence:p.confidence},'keyValuePairs['+i+']');});
 if(pairs.length>500||tables.length>50)issues.push('LAYOUT_LIMIT_REACHED');
 tables.slice(0,50).forEach((table,ti)=>{
  const cells=list(table.cells),rows=[...new Set<number>(cells.map(c=>c.rowIndex).filter(n=>Number.isInteger(n)&&n>=0))].sort((a,b)=>a-b);
  const source='tables['+ti+']';
  const title=cells.filter(c=>c.rowIndex<2).map(c=>norm(c.content)).join(' ');
  const headerRow=rows.slice(0,3).find(r=>cells.some(c=>c.rowIndex===r&&header(c.content)==='description'));
  if(headerRow!==undefined){
   const mapping=new Map<number,string>(),used=new Set<string>();let ambiguous=false;
   for(const c of cells.filter(c=>c.rowIndex===headerRow)){const k=header(c.content);if(!k)continue;if(used.has(k)||mapping.has(c.columnIndex)||(c.columnSpan??1)!==1||(c.rowSpan??1)!==1)ambiguous=true;used.add(k);mapping.set(c.columnIndex,k);}
   if(ambiguous||!['description','unit','quantity','aneelRate','grossRate','amount'].every(k=>used.has(k))){issues.push('AMBIGUOUS_OPERATION_HEADERS');return;}
   for(const ri of rows.filter(r=>r>headerRow).slice(0,500)){
    if(operations.length>=500){issues.push('LAYOUT_LIMIT_REACHED');break;}
    const rc=cells.filter(c=>c.rowIndex===ri);if(!rc.some(c=>text(c.content).trim()))continue;
    const f:Record<string,Field>={},rowIssues:string[]=[];
    for(const c of rc){const k=mapping.get(c.columnIndex);if(!k){if(text(c.content).trim())rowIssues.push('UNMAPPED_COLUMN');continue;}if(f[k]||(c.columnSpan??1)!==1||(c.rowSpan??1)!==1){rowIssues.push('MERGED_OR_DUPLICATE_CELL');continue;}f[k]=electricalField(raw,c,!['description','unit'].includes(k));
     if(k==='amount'&&/^[0-9.,]+-$/.test(text(c.content).trim())){const signed=decimalFromInvoice('-'+text(c.content).trim().slice(0,-1));if(signed!==null){f[k].decimal=signed;f[k].issues=f[k].issues.filter(i=>i!=='INVALID_DECIMAL');}}}
    const classified=classify(f.description?.text??'',f.unit?.text??'');
    if(classified.role==='UNKNOWN')rowIssues.push('UNMAPPED_COMPONENT');
    if(classified.component==='DEMAND_BILLED')rowIssues.push('DEMAND_MEASURED_UNUSED_SPLIT_REQUIRES_CONTEXT');
    if(classified.component==='ACL_DISTRIBUTOR_INFORMATION')rowIssues.push('DO_NOT_DUPLICATE_SUPPLIER_COST');
    if(classified.role==='CREDIT')rowIssues.push('CREDIT_SIGN_AND_REFERENCE_REQUIRE_REVIEW');
    if(Object.values(f).some(v=>v.text.trim()&&v.issues.length))rowIssues.push('FIELD_REVIEW_REQUIRED');
    const check=arithmetic(f);if(check.state==='DIVERGENT')rowIssues.push('QUANTITY_TARIFF_AMOUNT_DIVERGENCE');
    operations.push({source:source+'.row['+ri+']',row:ri,...classified,fields:f,issues:rowIssues,arithmetic:check});
   }
   if(rows.length>501)issues.push('LAYOUT_LIMIT_REACHED');return;
  }
  // Header and value must occupy the same single column in consecutive rows.
  for(const c of cells){const alias=aliases[norm(c.content)];if(!alias||(c.columnSpan??1)!==1||(c.rowSpan??1)!==1)continue;
   const matches=cells.filter(v=>v.rowIndex===c.rowIndex+1&&v.columnIndex===c.columnIndex&&(v.columnSpan??1)===1&&(v.rowSpan??1)===1);
   if(matches.length===1&&text(matches[0].content).trim()&&!aliases[norm(matches[0].content)])add(...alias,matches[0],source+'.row['+matches[0].rowIndex+'].column['+c.columnIndex+']');
  }
  let kind='',label='';
  if(/EQUIPAMENTOS DE MEDICAO|NIVEIS DE TENSAO/.test(title)){kind='METER_VOLTAGE';label='Equipamentos de medição e níveis de tensão';}
  else if(/BANDEIRAS TARIFARIAS|MICRO E MINI GERACAO/.test(title)){kind='FLAGS_GD';label='Bandeiras e micro/mini geração';}
  else if(/CONSUMO.*PONTA|DEMANDA.*PONTA|HISTORICO.*CONSUMO/.test(title)&&cells.some(c=>/\b(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ) ?[0-9]{2,4}\b/.test(norm(c.content)))){kind='HISTORY';label='Histórico — não substitui medições da competência';}
  else if(/MEDIDOR/.test(title)){kind='METER_READINGS';label='Leituras dos equipamentos';}
  else if(/TRIBUTO/.test(title)){kind='TAX_SUMMARY';label='Resumo tributário';}
  else if(/INDICADORES DE CONTINUIDADE|\b(?:DIC|FIC|DMIC|DICRI)\b/.test(title)){kind='CONTINUITY';label='Indicadores de continuidade';}
  if(kind)blocks.push({kind,label,source,rows:rows.slice(0,100).map(ri=>({index:ri,cells:cells.filter(c=>c.rowIndex===ri).sort((a,b)=>a.columnIndex-b.columnIndex).map(c=>({column:c.columnIndex,columnSpan:c.columnSpan??1,rowSpan:c.rowSpan??1,value:electricalField(raw,c)}))}))});
 });
 const totals=operations.filter(r=>r.component==='TOTAL_A_PAGAR'&&r.fields.amount?.decimal);
 if(totals.length===1)for(const r of operations){if(!r.fields.description?.text.trim()&&r.fields.amount?.decimal===totals[0].fields.amount.decimal&&Object.entries(r.fields).every(([k,v])=>k==='amount'||!v.text.trim())){r.component='UNLABELLED_TOTAL_REPEAT';r.role='INFORMATION';r.issues=r.issues.filter(i=>i!=='UNMAPPED_COMPONENT');r.issues.push('REPEATED_TOTAL_NOT_ADDED');}}
 if(!operations.length)issues.push('OPERATIONS_NOT_MAPPED');
 if(operations.some(r=>r.issues.length))issues.push('OPERATION_REVIEW_REQUIRED');
 for(const name of new Set(fields.map(f=>f.name))){const candidates=fields.filter(f=>f.name===name&&f.value.text.trim());if(new Set(candidates.map(f=>norm(f.value.text))).size>1)issues.push('CONFLICTING_'+name.toUpperCase());}
 const refs=[...new Set(fields.filter(f=>f.name==='reference').map(f=>cpflReference(f.value.text)))];
 measurements=extractCpflMeasurements(raw,refs.length===1?refs[0]:null);
 issues.push('IDENTITY_AND_PROFILE_REQUIRE_REVIEW','TOTALS_REQUIRE_RECONCILIATION','HOMOLOGATION_PENDING');
 return result();
}

/** Compatibility entry point for all existing review services. */
export function extractCpflPaulistaLayout(raw:any){return extractElektroLayout(raw)??extractCpflOnly(raw); }
