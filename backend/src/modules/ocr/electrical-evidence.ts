/** Read-only candidates. Labels do not prove invoice type, tax basis or financial approval. */
export type ElectricalComponent = 'TE'|'TUSD_ENERGY'|'DEMAND_CONTRACTED'|'DEMAND_MEASURED'|'DEMAND_UNUSED'|'DEMAND_EXCESS'|'DEMAND_BILLED'|'REACTIVE_ENERGY'|'PENALTY'|'INTEREST'|'ICMS'|'PIS'|'COFINS'|'IOF'|'OTHER';
export interface ElectricalField {text:string;decimal:string|null;confidence:number|null;pages:number[];spans:{offset:number;length:number}[];issues:string[];}
export interface ElectricalRow {index:number;source:string;component:ElectricalComponent;period:'PEAK'|'OFF_PEAK'|'UNSPECIFIED';description:ElectricalField;quantity:ElectricalField;unit:ElectricalField;unitPrice:ElectricalField;amount:ElectricalField;confidence:number|null;issues:string[];}
const text=(value:unknown)=>typeof value==='string'?value:'';
const normalized=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
/** pt-BR source text only. Never reuse provider float values or round tariffs. */
export function decimalFromInvoice(value:string):string|null {
 const v=value.trim().replace(/^(?:R\$|BRL)\s*/,'').replace(/\u00a0/g,' ');
 if(!/^-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,9})?$/.test(v))return null;
 const n=v.replace(/\./g,'').replace(',','.');
 if(n.replace(/[-.]/g,'').length>24)return null;
 const [whole,fraction]=n.split('.');const negative=whole.startsWith('-');const digits=whole.replace('-','').replace(/^0+(?=\d)/,'');
 return (negative?'-':'')+digits+(fraction!==undefined?'.'+fraction:'');
}
export function classifyElectricalLine(description:string){
 let d=normalized(description);const off=/\bFORA PONTA\b/.test(d);d=d.replace(/\bFORA PONTA\b/g,' ');const peak=/\bPONTA\b/.test(d);
 const period:ElectricalRow['period']=off&&!peak?'OFF_PEAK':peak&&!off?'PEAK':'UNSPECIFIED';
 const te=/\bTE\b/.test(d),tusd=/\bTUSD\b/.test(d);let component:ElectricalComponent='OTHER';
 if(te&&tusd)return {component,period};
 if(/\bMULTA\b/.test(d))component='PENALTY';
 else if(/\bJUROS\b/.test(d))component='INTEREST';
 else if(/\bDEMANDA\b/.test(d)){
  if(/\bULTRAPASSAGEM\b|\bEXCEDENTE\b/.test(d))component='DEMAND_EXCESS';
  else if(/\bNAO UTILIZADA\b/.test(d))component='DEMAND_UNUSED';
  else if(/\bCONTRATADA\b/.test(d)&&!/\bMEDIDA\b|\bREGISTRADA\b/.test(d))component='DEMAND_CONTRACTED';
  else if(/\bMEDIDA\b|\bREGISTRADA\b/.test(d)&&!/\bCONTRATADA\b/.test(d))component='DEMAND_MEASURED';
  else if(!/\bCONTRATADA\b|\bMEDIDA\b|\bREGISTRADA\b/.test(d))component='DEMAND_BILLED';
 }
 else if(/\bENERGIA REATIVA\b|\bEXCEDENTE REATIVO\b|\bUFER\b/.test(d))component='REACTIVE_ENERGY';
 else if(te)component='TE';else if(tusd)component='TUSD_ENERGY';
 else {const taxes=(['ICMS','PIS','COFINS','IOF'] as const).filter(t=>new RegExp('\\b'+t+'\\b').test(d));if(taxes.length===1)component=taxes[0];}
 return {component,period};
}
function field(raw:Record<string,any>,input:any,numeric=false):ElectricalField{
 const value=text(input?.content);const content=text(raw.content);const pagesRaw=Array.isArray(raw.pages)?raw.pages:[];
 const spans=Array.isArray(input?.spans)?input.spans.filter((s:any)=>Number.isInteger(s.offset)&&s.offset>=0&&Number.isInteger(s.length)&&s.length>0&&s.offset+s.length<=content.length).map((s:any)=>({offset:s.offset,length:s.length})):[];
 const pages:number[]=[...new Set<number>((Array.isArray(input?.boundingRegions)?input.boundingRegions:[]).map((r:any)=>r.pageNumber).filter((n:any)=>pagesRaw.some((p:any)=>p.pageNumber===n)&&Number.isInteger(n)))];
 const confidence=typeof input?.confidence==='number'&&Number.isFinite(input.confidence)&&input.confidence>=0&&input.confidence<=1?input.confidence:null;
 const decimal=numeric?decimalFromInvoice(value):null;const issues:string[]=[];
 if(!value.trim())issues.push('MISSING_VALUE');
 const source=spans.map((s:any)=>content.slice(s.offset,s.offset+s.length)).join(' ');
 if(!spans.length||!pages.length||source.replace(/\s/g,'')!==value.replace(/\s/g,''))issues.push('UNVERIFIED_SOURCE');
 if(confidence===null)issues.push('MISSING_CONFIDENCE');else if(confidence<0.45)issues.push('CONFIDENCE_BELOW_45');else if(confidence<=0.85)issues.push('CONFIDENCE_REQUIRES_REVIEW');
 if(numeric&&decimal===null)issues.push('INVALID_DECIMAL');
 if(input?.valueCurrency?.currencyCode&&input.valueCurrency.currencyCode!=='BRL')issues.push('NON_BRL_CURRENCY');
 return {text:value.slice(0,2000),decimal,confidence,pages,spans,issues};
}
function row(raw:Record<string,any>,fields:any,index:number,source:string):ElectricalRow{
 const description=field(raw,fields.Description),quantity=field(raw,fields.Quantity,true),unit=field(raw,fields.Unit),unitPrice=field(raw,fields.UnitPrice,true),amount=field(raw,fields.Amount,true);
 const classified=classifyElectricalLine(description.text);const issues:string[]=[];const values=[description,quantity,unit,unitPrice,amount];
 if(classified.component==='OTHER')issues.push('UNMAPPED_COMPONENT');
 const u=normalized(unit.text);
 if(['TE','TUSD_ENERGY'].includes(classified.component)&&!['KWH','MWH'].includes(u))issues.push('ENERGY_UNIT_UNVERIFIED');
 if(classified.component.startsWith('DEMAND_')&&u!=='KW')issues.push('DEMAND_UNIT_UNVERIFIED');
 if(classified.component==='REACTIVE_ENERGY'&&u!=='KVARH')issues.push('REACTIVE_UNIT_UNVERIFIED');
 if(['TE','TUSD_ENERGY','DEMAND_CONTRACTED','DEMAND_MEASURED','DEMAND_UNUSED','DEMAND_EXCESS','DEMAND_BILLED'].includes(classified.component)&&classified.period==='UNSPECIFIED')issues.push('TARIFF_PERIOD_UNSPECIFIED');
 if(values.some(v=>v.decimal?.startsWith('-')))issues.push('CREDIT_REQUIRES_REVIEW');
 if(values.some(v=>v.issues.length))issues.push('FIELD_REVIEW_REQUIRED');
 return {index,source,...classified,description,quantity,unit,unitPrice,amount,confidence:values.every(v=>v.confidence!==null)?Math.min(...values.map(v=>v.confidence!)):null,issues};
}
const headers:Record<string,string>={'DESCRICAO':'Description','DESCRICAO DO ITEM':'Description','ITENS DA FATURA':'Description','QUANTIDADE':'Quantity','QTD':'Quantity','UNIDADE':'Unit','UN':'Unit','TARIFA':'UnitPrice','TARIFA UNITARIA':'UnitPrice','VALOR UNITARIO':'UnitPrice','PRECO UNITARIO':'UnitPrice','VALOR':'Amount','VALOR TOTAL':'Amount','TOTAL':'Amount'};
export function extractElectricalEvidence(raw:Record<string,any>){
 const documents=Array.isArray(raw.documents)?raw.documents:[];const issues:string[]=[];const rows:ElectricalRow[]=[];
 if(documents.length!==1)return {version:'electrical-evidence-v1',canImport:false,rows,issues:['INVOICE_COUNT_NOT_ONE'],taxDetails:[]};
 const fields=documents[0]?.fields??{};const items=fields.Items?.valueArray;
 if(Array.isArray(items)&&items.length){
  if(items.length>500)issues.push('ITEM_LIMIT_REACHED');
  items.slice(0,500).forEach((item:any,index:number)=>rows.push(row(raw,item?.valueObject??{},index,'Items['+index+']')));
  if(Array.isArray(raw.tables)&&raw.tables.length)issues.push('TABLES_REQUIRE_COVERAGE_REVIEW');
 }else{
  const tables=Array.isArray(raw.tables)?raw.tables:[];
  tables.slice(0,30).forEach((table:any,tableIndex:number)=>{
   const cells=Array.isArray(table.cells)?table.cells:[];const mapping=new Map<number,string>();let ambiguous=false;
   for(const cell of cells.filter((c:any)=>c.rowIndex===0)){const name=headers[normalized(text(cell.content))];if(!name)continue;if([...mapping.values()].includes(name)||mapping.has(cell.columnIndex)||(cell.columnSpan??1)!==1||(cell.rowSpan??1)!==1)ambiguous=true;mapping.set(cell.columnIndex,name);}
   if(ambiguous||![...mapping.values()].includes('Description')||![...mapping.values()].includes('Amount')){issues.push('UNMAPPED_TABLE');return;}
   const indices=[...new Set<number>(cells.map((c:any)=>c.rowIndex).filter((n:any)=>Number.isInteger(n)&&n>0))].sort((a,b)=>a-b);
   for(const index of indices){if(rows.length>=500){issues.push('ITEM_LIMIT_REACHED');break;}const mapped:any={};let rowAmbiguous=false;
    for(const cell of cells.filter((c:any)=>c.rowIndex===index)){const name=mapping.get(cell.columnIndex);if(!name)continue;if(mapped[name]||(cell.columnSpan??1)!==1||(cell.rowSpan??1)!==1){rowAmbiguous=true;break;}mapped[name]={...cell,confidence:null};}
    if(rowAmbiguous){issues.push('AMBIGUOUS_TABLE_ROW');continue;}rows.push(row(raw,mapped,rows.length,'tables['+tableIndex+'].row['+index+']'));
   }
  });
  if(tables.length>30)issues.push('TABLE_LIMIT_REACHED');
 }
 if(!rows.length)issues.push('NO_ITEM_ROWS');
 if(rows.some(r=>r.component==='OTHER'))issues.push('UNMAPPED_ITEMS');
 // TaxDetails has no reliable tax name: preserve values without guessing ICMS/PIS/COFINS.
 const taxes=Array.isArray(fields.TaxDetails?.valueArray)?fields.TaxDetails.valueArray:[];
 const taxDetails=taxes.slice(0,100).map((entry:any,index:number)=>({index,amount:field(raw,entry?.valueObject?.Amount,true),rate:field(raw,entry?.valueObject?.Rate),tax:'UNIDENTIFIED',basis:'UNVERIFIED'}));
 if(taxes.length>100)issues.push('TAX_LIMIT_REACHED');
 return {version:'electrical-evidence-v1',canImport:false,rows,issues:[...new Set(issues)],taxDetails};
}
