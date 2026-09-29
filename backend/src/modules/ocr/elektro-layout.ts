import {electricalField, classifyElectricalLine, type ElectricalField} from './electrical-evidence';
import type {CpflOperation,Block} from './cpfl-paulista-layout';
import {cpflPreparationPreview} from './cpfl-preparation-preview';
import {invoiceLayoutLibrary} from './layout-library';
const list=(v:any):any[]=>Array.isArray(v)?v:[];
const norm=(v:any)=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
const page1=(v:any)=>list(v?.boundingRegions).some(r=>r.pageNumber===1);
const cents=(v:string|null|undefined)=>{if(!v||!/^[-]?\d+(?:\.\d{1,2})?$/.test(v))return null;const neg=v.startsWith('-'),[a,b='']=v.replace('-','').split('.');return (BigInt(a)*100n+BigInt(b.padEnd(2,'0')))*(neg?-1n:1n);};
const amount=(n:bigint)=>{const a=n<0n?-n:n;return (n<0n?'-':'')+(a/100n)+'.'+(a%100n).toString().padStart(2,'0');};
export const elektroColumns=[['description','Componente'],['unit','Unid.'],['quantity','Quantidade faturada'],['grossRate','Preço unitário com tributos'],['amount','Valor da operação'],['pisCofinsAmount','PIS/Cofins conjunto'],['icmsBase','Base ICMS'],['icmsRate','Alíquota ICMS (%)'],['icmsAmount','ICMS'],['netRate','Tarifa unitária da fatura']];
function arithmetic(f:Record<string,ElectricalField>){
 if(!f.quantity?.decimal||!f.grossRate?.decimal||cents(f.amount?.decimal)===null)return {state:'NOT_VERIFIABLE',differenceCents:null};
 const fraction=(s:string)=>{const [a,b='']=s.split('.');return {n:BigInt(a+b),d:10n**BigInt(b.length)};};
 const q=fraction(f.quantity.decimal),t=fraction(f.grossRate.decimal),n=q.n*t.n*100n,d=q.d*t.d,rounded=((n<0n?-n:n)+d/2n)/d*(n<0n?-1n:1n),diff=rounded-cents(f.amount.decimal)!;
 return {state:diff>=-1n&&diff<=1n?'MATCH_WITHIN_ONE_CENT':'DIVERGENT',differenceCents:diff.toString()};
}
/** Layout-specific projection; page-two measurement labels never become financial postings. */
export function extractElektroLayout(raw:any){
 const lines=list(list(raw?.pages).find(p=>p.pageNumber===1)?.lines);
 const vendor=norm(raw?.documents?.[0]?.fields?.VendorName?.content);
 const issuer=vendor==='ELEKTRO REDES S A'||lines.some(l=>norm(l.content)==='ELEKTRO REDES S A');
 const pairs=list(raw?.keyValuePairs),supply=pairs.filter(p=>page1(p.key)&&norm(p.key?.content)==='TIPO DE FORNECIMENTO').map(p=>norm(p.value?.content));
 if(!issuer||!supply.some(s=>s.includes('HORARIA VERDE')))return null;
 const fields:{name:string;label:string;value:ElectricalField;source:string}[]=[],operations:CpflOperation[]=[],blocks:Block[]=[],issues:string[]=[];
 const aliases:Record<string,[string,string]>={'NOME DO CLIENTE':['customer','Razão social'],'NUMERO DA UNIDADE CONSUMIDORA':['unit','Número da UC'],'NOTA FISCAL NO':['invoiceNumber','Nota fiscal'],'SERIE':['series','Série'],'DATA DE EMISSAO':['issueDate','Data de emissão'],'REF MES ANO':['reference','Competência'],'TOTAL A PAGAR':['invoiceTotal','Total a pagar'],'VENCIMENTO':['dueDate','Vencimento'],'CLASSIFICACAO':['classification','Classificação'],'TIPO DE FORNECIMENTO':['supply','Fornecimento'],'LEITURA ANTERIOR':['previousReading','Leitura anterior'],'LEITURA ATUAL':['currentReading','Leitura atual'],'N DE DIAS':['billingDays','Dias faturados'],'PROXIMA LEITURA':['nextReading','Próxima leitura']};
 pairs.slice(0,500).forEach((p,i)=>{if(!page1(p.key))return;const key=norm(p.key?.content),alias=aliases[key];if(alias&&String(p.value?.content??'').trim())fields.push({name:alias[0],label:alias[1],value:electricalField(raw,{...p.value,confidence:p.confidence},alias[0]==='invoiceTotal'),source:'keyValuePairs['+i+']'});
  // Masked customer ID is in the key. Its paired value can be an unrelated state registration.
  if(/^CNPJ\s*[-:]?\s*\*{8}\s*\d{6}\s*$/i.test(String(p.key?.content??'')))fields.push({name:'customerTaxId',label:'CNPJ do cliente — parcialmente oculto',value:electricalField(raw,{...p.key,confidence:p.confidence}),source:'keyValuePairs['+i+'].key'});
 });
 const addressStart=lines.findIndex(l=>norm(l.content)==='ENDERECO');
 if(addressStart>=0){const address=lines.slice(addressStart+1,addressStart+12).filter(l=>Array.isArray(l.polygon)&&l.polygon[0]<2.5);const end=address.findIndex(l=>/CEP\s*\d{5}/.test(String(l.content)));if(end>=0){const selected=address.slice(0,end+1);fields.push({name:'serviceAddress',label:'Endereço da unidade',value:electricalField(raw,{content:selected.map(l=>l.content).join('\n'),spans:selected.flatMap(l=>list(l.spans)),boundingRegions:[{pageNumber:1}]}),source:'pages[0].customerAddress'});}}
 const tables=list(raw?.tables);let financialTables=0;
 tables.slice(0,50).forEach((table,ti)=>{
 const cells=list(table.cells),header=cells.filter(c=>c.rowIndex===0).sort((a,b)=>a.columnIndex-b.columnIndex),h=header.map(c=>norm(c.content)),source='tables['+ti+']';
 const financial=h[0]==='ITENS DE FATURA'&&h[1]==='UNID'&&h[2]==='QUANT'&&h[4]==='VALOR RS'&&h[5]==='PIS COFINS RS';
 const rows=[...new Set<number>(cells.map(c=>c.rowIndex).filter(Number.isInteger))].sort((a,b)=>a-b);
 if(financial){financialTables++;if(!page1(table)||header.length!==10||!['PREC OUNIT COM TRIB RS','PRECOUNIT COM TRIB RS','PRECO UNIT COM TRIB RS'].includes(h[3])||h[6]!=='BASE CALC ICMS RS'||h[7]!=='ALIQUOTA ICMS'||h[8]!=='ICMS RS'||h[9]!=='TARIFA UNIT RS'||header.some((c,i)=>c.columnIndex!==i||(c.columnSpan??1)!==1||(c.rowSpan??1)!==1)){issues.push('AMBIGUOUS_FINANCIAL_TABLE');return;}
 for(const ri of rows.filter(r=>r>0).slice(0,500)){
 const f:Record<string,ElectricalField>={},rowIssues:string[]=[];
 for(const [ci,[key]] of elektroColumns.entries()){const found=cells.filter(c=>c.rowIndex===ri&&c.columnIndex===ci);if(found.length>1||found.some(c=>(c.columnSpan??1)!==1||(c.rowSpan??1)!==1))rowIssues.push('MERGED_OR_DUPLICATE_CELL');f[key]=electricalField(raw,found.length===1?found[0]:null,!['description','unit','icmsRate'].includes(key));}
 if(!f.amount.text.trim()){issues.push('FINANCIAL_ROW_WITHOUT_AMOUNT');continue;}
 const d=norm(f.description.text),base=classifyElectricalLine(f.description.text);let component:string=base.component,role:CpflOperation['role']='CHARGE';
 if(/^TUSD ENERGIA/.test(d))component='TUSD_ENERGY';else if(/^CONSUMO REAT/.test(d))component='REACTIVE_ENERGY';else if(/^DEMANDA DE DISTRIBUICAO/.test(d))component='DEMAND_BILLED';else if(/^SUBSIDIO TARIFARIO LIQ/.test(d)){component='SUBSIDY_CREDIT';role='CREDIT';}else if(/^SUBSIDIO TARIFARIO/.test(d))component='TARIFF_SUBSIDY';else if(/^DEVOLUCAO/.test(d)){component='REFUND';role='CREDIT';}
 if(component==='OTHER'){role='UNKNOWN';rowIssues.push('UNMAPPED_COMPONENT');}
 if(role==='CREDIT'&&!(f.amount.decimal??'').startsWith('-'))rowIssues.push('CREDIT_SIGN_REQUIRES_REVIEW');
 const check=arithmetic(f);if(check.state==='DIVERGENT')rowIssues.push('QUANTITY_TARIFF_AMOUNT_DIVERGENCE');
 if(Object.values(f).some(v=>v.text.trim()&&v.issues.length))rowIssues.push('FIELD_REVIEW_REQUIRED');
 operations.push({source:source+'.row['+ri+']',row:ri,component,period:base.period,role,fields:f,issues:rowIssues,arithmetic:check});
 }return;}
 const title=h.join(' ');let kind='',label='';
 if(/TRIBUT O|TRIBUTO/.test(title)){kind='TAX_SUMMARY';label='Resumo tributário — ICMS, PIS e Cofins';}
 else if(/MEDIDOR/.test(title)){kind='METER_READINGS';label='Medições — não são novas cobranças';}
 else if(h[0]==='DESCRICAO'&&title.includes('LEITURA')){kind='METER_DEMONSTRATION';label='Demonstrativo de leituras — não somado ao faturamento';}
 else if(cells.some(c=>/MONTANTE EM TODOS OS/.test(norm(c.content)))){kind='CONTRACTED_DEMAND';label='Montantes contratados informados';}
 if(kind)blocks.push({kind,label,source,rows:rows.slice(0,100).map(ri=>({index:ri,cells:cells.filter(c=>c.rowIndex===ri).map(c=>({column:c.columnIndex,columnSpan:c.columnSpan??1,rowSpan:c.rowSpan??1,value:electricalField(raw,c)}))}))});
 });
 const totals=fields.filter(f=>f.name==='invoiceTotal');const totalValues=[...new Set(totals.map(f=>f.value.decimal))];
 const valid=raw?.documents?.length===1&&financialTables===1&&!issues.includes('AMBIGUOUS_FINANCIAL_TABLE')&&operations.length>0&&operations.every(r=>r.role!=='UNKNOWN'&&cents(r.fields.amount.decimal)!==null&&!r.fields.amount.issues.includes('UNVERIFIED_SOURCE')&&!r.issues.includes('MERGED_OR_DUPLICATE_CELL'));
 const total=totalValues.length===1&&totals.every(f=>!f.value.issues.includes('UNVERIFIED_SOURCE'))?cents(totalValues[0]):null,sum=valid?operations.reduce((a,r)=>a+cents(r.fields.amount.decimal)!,0n):null,diff=sum!==null&&total!==null?sum-total:null;
 const reconciliation={state:diff===null?'NOT_VERIFIABLE':diff===0n?'MATCH':'DIVERGENT',checks:[{label:'Cobranças e créditos versus total a pagar (sem repetir demonstrativo)',state:diff===null?'NOT_VERIFIABLE':diff===0n?'MATCH':'DIVERGENT',differenceCents:diff?.toString()??null}]};
 const taxSummary=blocks.filter(b=>b.kind==='TAX_SUMMARY');
 const declaredTax=(name:string)=>{if(taxSummary.length!==1)return null;const b=taxSummary[0],matches=b.rows.filter(r=>r.cells.some(c=>c.column===0&&norm(c.value.text)===name));if(matches.length!==1)return null;const row=matches[0],v=row.cells.filter(c=>c.column===3);if(v.length!==1||v[0].columnSpan!==1||v[0].rowSpan!==1||v[0].value.issues.some(i=>i!=='MISSING_CONFIDENCE'))return null;const cell=list(tables[Number(b.source.match(/\d+/)?.[0])]?.cells).find(c=>c.rowIndex===row.index&&c.columnIndex===3),f=electricalField(raw,cell,true),n=cents(f.decimal);return n===null?null:{n,value:f,source:b.source+'.row['+row.index+'].column[3]'};};
 const icms=declaredTax('ICMS'),pis=declaredTax('PIS'),cofins=declaredTax('COFINS');
 const checks=[['icmsAmount','ICMS'],['pisCofinsAmount','PIS/Cofins conjunto']].map(([key,label])=>{const charges=operations.filter(r=>r.role==='CHARGE'),values=charges.map(r=>r.issues.includes('MERGED_OR_DUPLICATE_CELL')||r.fields[key]?.issues.some(i=>i!=='MISSING_CONFIDENCE')?null:cents(r.fields[key]?.decimal)),complete=values.length>0&&values.every(v=>v!==null),sum=complete?values.reduce<bigint>((a,v)=>a+v!,0n):null;const declared=key==='icmsAmount'?icms?.n??null:pis&&cofins?pis.n+cofins.n:null,difference=sum!==null&&declared!==null?sum-declared:null;return {key,label,state:difference===null?'MISSING':difference===0n?'MATCH_EXTRACTED':'DIFFERENCE_EXTRACTED',extracted:sum===null?null:amount(sum),declared:declared===null?null:amount(declared),difference:difference===null?null:amount(difference),count:values.filter(v=>v!==null).length,expected:charges.length,partial:!complete,sources:[...charges.map(r=>r.source+'.'+key),...(key==='icmsAmount'?(icms?[icms.source]:[]):[pis?.source,cofins?.source].filter((v):v is string=>!!v))],summary:key==='icmsAmount'&&icms?{value:icms.value,source:icms.source}:null};});
 if(raw?.documents?.length!==1)issues.push('INVOICE_COUNT_NOT_ONE');if(financialTables!==1)issues.push('FINANCIAL_TABLE_COUNT_NOT_ONE');
 return {taxReconciliation:{canImport:false as const,supplierReferenceCount:0,checks,message:'PIS/Cofins é apresentado em conjunto nas parcelas. Resumo fiscal preservado abaixo; nenhuma separação por estimativa nem nova incidência.'},preparation:valid?cpflPreparationPreview(operations):null,measurements:null,version:'neoenergia-elektro-verde@0.1.0',layoutId:'neoenergia-elektro-verde',name:'Neoenergia Elektro · Horária Verde',status:'IN_HOMOLOGATION',canImport:false,library:invoiceLayoutLibrary,columns:elektroColumns,fields,operations,blocks,issues:[...new Set([...issues,'IDENTITY_AND_PROFILE_REQUIRE_REVIEW','HOMOLOGATION_PENDING'])],coverage:[{label:'Identificação e período',mapped:['customer','customerTaxId','serviceAddress','unit','reference','dueDate','currentReading','previousReading'].filter(k=>fields.some(f=>f.name===k)).length,expected:8},{label:'Dados fiscais',mapped:['invoiceNumber','series','issueDate'].filter(k=>fields.some(f=>f.name===k)).length,expected:3},{label:'Colunas da tabela de operações',mapped:elektroColumns.filter(([k])=>operations.some(r=>r.fields[k]?.text.trim())).length,expected:10}],reconciliation,financialReconciliation:reconciliation.state,reviewMessage:'Layout Elektro em homologação. Página de faturamento alimenta a prévia; demonstrativo é evidência separada. CNPJ oculto e ambiente de mercado exigem vínculo cadastral auditado. Não há aprovação automática nem duplicação de TE/TUSD.'};
}
