import { extractInvoiceEvidence, OcrEvidence } from './invoice-evidence';
export type CheckState = 'MATCH' | 'MISMATCH' | 'REVIEW';
export interface IntakeCheck { field:string; label:string; state:CheckState; message:string; confidence:number|null; pages:number[]; }
export interface IntakeContext { customer: { company_name?:string; document?:string }|null; unit:{consumer_unit_number?:string;address?:string;free_market?:boolean|null}|null; referenceMonth:string; otherDocumentInPeriod:boolean; }
const normalize=(value:unknown)=>typeof value==='string'?value.normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,''):'';
const identifier=(value:unknown)=>normalize(value); // Keep letters and leading zeroes; never coerce identifiers to numbers.
function period(value:string):string {
 const v=value.trim();let m=v.match(/^(\d{4})-(0[1-9]|1[0-2])$/);if(m)return v;
 m=v.match(/^(0?[1-9]|1[0-2])\s*\/\s*(\d{4})$/);if(m)return m[2]+'-'+m[1].padStart(2,'0');
 const names=['JANEIRO','FEVEREIRO','MARCO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
 const n=v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().match(/^([A-Z]+)[\s/.-]+(\d{4})$/);
 if(n){const i=names.findIndex(name=>name===n[1]||name.slice(0,3)===n[1]);if(i>=0)return n[2]+'-'+String(i+1).padStart(2,'0');}return '';
}
/** Conservative candidates only. No fuzzy identity matching or due-date fallback. */
export function assessInvoiceIntake(raw:Record<string,any>,context:IntakeContext){
 const evidence=extractInvoiceEvidence(raw);const checks:IntakeCheck[]=[];
 const pair=(labels:string[]):OcrEvidence|null=>{
  const matches=(Array.isArray(raw.keyValuePairs)?raw.keyValuePairs:[]).filter((p:any)=>labels.includes(normalize(p?.key?.content)));
  if(matches.length!==1)return null;const p=matches[0];const value=p.value;
  if(typeof value?.content!=='string'||!value.content.trim())return null;
  const text=typeof raw.content==='string'?raw.content:'';
  const spans=(Array.isArray(value.spans)?value.spans:[]).filter((s:any)=>Number.isInteger(s.offset)&&s.offset>=0&&Number.isInteger(s.length)&&s.length>0&&s.offset+s.length<=text.length);
  const pages:number[]=[...new Set<number>((Array.isArray(value.boundingRegions)?value.boundingRegions:[]).map((r:any)=>r.pageNumber).filter((n:any)=>Number.isInteger(n)&&(raw.pages??[]).some((page:any)=>page.pageNumber===n)))];
  const confidence=typeof p.confidence==='number'&&Number.isFinite(p.confidence)&&p.confidence>=0&&p.confidence<=1?p.confidence:null;
  return {content:value.content,confidence,pages,spans};
 };
 const compare=(field:string,label:string,value:OcrEvidence|null,expected:unknown,format:(s:string)=>string=normalize)=>{
  const actual=value?format(value.content):'';const target=typeof expected==='string'?format(expected):'';
  let state:CheckState='REVIEW';let message='Informação ausente, ambígua ou sem evidência suficiente; conferir a fatura e o cadastro.';
  if(actual&&target&&value?.pages.length&&value.spans.length&&value.confidence!==null&&value.confidence>0.85){state=actual===target?'MATCH':'MISMATCH';message=state==='MATCH'?'Compatível com o cadastro consultado.':'Divergência entre a fatura e o cadastro selecionado. Importação bloqueada.';}
  else if(value?.confidence!==null&&value?.confidence!==undefined&&value.confidence<0.45)message='Confiança abaixo de 45%; processamento automático rejeitado.';
  else if(value?.confidence!==null&&value?.confidence!==undefined&&value.confidence<=0.85)message='Confiança entre 45% e 85%; conferência humana obrigatória.';
  checks.push({field,label,state,message,confidence:value?.confidence??null,pages:value?.pages??[]});
 };
 const uc=pair(['UC','UNIDADECONSUMIDORA','NUMERODAUNIDADECONSUMIDORA','NUMERODAINSTALACAO']);
 const month=pair(['REFERENCIA','MESDEREFERENCIA','MESANO','COMPETENCIA']);
 const market=pair(['AMBIENTEDECONTRATACAO','MERCADODEENERGIA','AMBIENTE']);
 compare('customer','Empresa',evidence.fields.CustomerName,context.customer?.company_name);
 compare('taxId','CNPJ do cliente',evidence.fields.CustomerTaxId,context.customer?.document,s=>{const n=identifier(s);return /^[0-9A-Z]{12}[0-9]{2}$/.test(n)?n:'';});
 compare('unit','Unidade consumidora',uc,context.unit?.consumer_unit_number,identifier);
 compare('address','Endereço da instalação',evidence.fields.ServiceAddress,context.unit?.address);
 compare('period','Mês/ano de referência',month,context.referenceMonth,period);
 compare('market','Ambiente ACL/ACR',market,context.unit?.free_market===true?'ACL':context.unit?.free_market===false?'ACR':undefined,s=>{const n=normalize(s);return ['ACL','AMBIENTEDECONTRATACAOLIVRE'].includes(n)?'ACL':['ACR','AMBIENTEDECONTRATACAOREGULADA'].includes(n)?'ACR':'';});
 const text=normalize(raw.content);const energyCandidate=!!uc&&/KWH|MWH/.test(text)&&/ENERGIA|TUSD/.test(text)&&evidence.issues.every(x=>x!=='INVOICE_COUNT_NOT_ONE');
 checks.unshift({field:'documentType',label:'Fatura de energia',state:'REVIEW',message:energyCandidate?'Indícios de fatura de energia encontrados; layout da distribuidora ainda requer homologação.':'Não foi possível identificar com segurança uma fatura de energia. Importação bloqueada.',confidence:null,pages:[]});
 checks.push({field:'duplicate',label:'Duplicidade na competência',state:context.otherDocumentInPeriod?'REVIEW':'MATCH',message:context.otherDocumentInPeriod?'Já existe outro arquivo de distribuidora nesta unidade e competência. Conferir duplicidade ou reemissão, sem substituir o anterior.':'Nenhum outro arquivo de distribuidora encontrado nesta unidade e competência nesta consulta.',confidence:null,pages:[]});
 checks.push({field:'completeness',label:'Páginas e campos elétricos',state:'REVIEW',message:'Conferência de todas as páginas, tarifas, tributos e vigência elétrica ainda pendente. A extração não alimenta o motor.',confidence:null,pages:[]});
 return {version:'invoice-intake-v1',decision:checks.some(c=>c.state==='MISMATCH'||(c.confidence!==null&&c.confidence<0.45))?'REJECT_AUTOMATION':'REVIEW_REQUIRED',canImport:false,checks};
}
