import type {TariffPreview} from './tariff-preview';
export type IncludedTaxReference={id:string;revision:number;label:string;operation:string;exactAmount:null};
/** Reconcile approved embedded-tax references without extracting or adding tax amounts. */
export function includedTaxReferences(p:any,scoped:any[],tariffs:TariffPreview,period:{start:string;end:string}):IncludedTaxReference[]{
 const fail=(message:string):never=>{throw new Error(message);};
 const validDate=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
 if(p.amount_text!=null&&(typeof p.amount_text!=='string'||!/^(0|[1-9][0-9]*)([.][0-9]{1,6})?$/.test(p.amount_text)||p.amount_text.length>80||Number(p.amount_text)>100))fail('Alíquota informativa inválida para o tributo já incluído.');
 const basis=p.tax_basis,items=basis?.items;
 if(basis?.version!==1||!Array.isArray(items)||!items.length||items.length>100||items.some(i=>!i||typeof i.parameterId!=='string'||!Number.isInteger(i.revision)||i.revision<1||!['INCLUDE','EXCLUDE'].includes(i.operation))||new Set(items.map(i=>i.parameterId)).size!==items.length||!items.some(i=>i.operation==='INCLUDE'))fail('Classifique as rubricas do tributo já incluído, com referências e revisões válidas.');
 if(basis.interaction!=null&&basis.interaction!=='INDEPENDENT'||basis.taxes!=null&&(!Array.isArray(basis.taxes)||basis.taxes.length)||basis.groupCodes!=null&&(!Array.isArray(basis.groupCodes)||basis.groupCodes.length))fail('Tributo já incluído não admite composição sequencial nem cálculo conjunto.');
 return items.map((item:any)=>{
  const matches=scoped.filter(r=>r.id===item.parameterId&&r.organization_id===p.organization_id&&r.customer_id===p.customer_id&&r.consumer_unit_id===p.consumer_unit_id&&r.scenario===p.scenario&&(r.kind==='TARIFF'||r.kind==='COST'&&r.monetary_source!=null)),ref=matches[0];
  if(matches.length!==1||ref.status!=='APPROVED'||ref.revision!==item.revision||!validDate(ref.start_date)||!validDate(ref.end_date)||ref.start_date>p.start_date||ref.end_date<p.end_date)fail('Uma rubrica do tributo incluído foi alterada, retirada ou não cobre sua vigência.');
  const lines=tariffs.lines.filter(l=>l.parameterId===ref.id&&l.revision===ref.revision&&l.scenario===p.scenario),line=lines[0];
  if(lines.length!==1||line.startDate>period.start||line.endDate<period.end||tariffs.pending.some(l=>l.parameterId===ref.id))fail('Uma rubrica do tributo incluído está sem memória válida para esta competência.');
  const codes=ref.embedded_tax_codes??[],lineCodes=line.embeddedTaxCodes;
  if(!Array.isArray(codes)||!Array.isArray(lineCodes)||new Set(codes).size!==codes.length||new Set(lineCodes).size!==lineCodes.length||codes.some((c:any)=>typeof c!=='string'||!/^(ICMS|PIS|COFINS|IOF|OTHER_[A-Z0-9_]+)$/.test(c))||codes.length!==lineCodes.length||codes.some((c:string)=>!lineCodes.includes(c))||ref.treatment!==line.treatment||!['NET','GROSS'].includes(ref.treatment)||ref.treatment==='NET'&&codes.length||ref.treatment==='GROSS'&&!codes.length)fail('Tratamento ou códigos embutidos divergentes na rubrica referenciada.');
  const embedded=ref.treatment==='GROSS'&&codes.includes(p.component_code);
  if((item.operation==='INCLUDE')!==embedded)fail('A classificação deve incluir exatamente as rubricas que declaram este tributo embutido.');
  return {id:ref.id,revision:ref.revision,label:ref.label,operation:item.operation,exactAmount:null};
 });
}
