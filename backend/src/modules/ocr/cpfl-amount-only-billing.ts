import type {CpflOperation} from './cpfl-paulista-layout';
const months=['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
/** Derived billing aliases only. Missing quantity/rate/tax cells stay missing. */
export function cpflAmountOnlyBilling(rows:CpflOperation[],reference:string,verified:(field:any)=>boolean){
 const proofs:{source:string;component:string;reference:string;amount:string;unprintedFields:string[]}[]=[];
 const operations=rows.map(row=>{
  if(row.role!=='UNKNOWN'||row.component!=='OTHER'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(reference)||row.issues.some(i=>['MERGED_OR_DUPLICATE_CELL','UNMAPPED_COLUMN','UNVERIFIED_SOURCE'].includes(i)))return row;
  const label=String(row.fields.description?.text??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();
  const demand=/^DEM DIF CONTRATO USD\s*\[KW\]\s*(\d{1,3}(?:[.,]\d{1,4})?)%\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\/(\d{2}|20\d{2})$/.exec(label);
  const subsidy=/^SUBVENCAO TARIF(?:ARIA)?\.?\s*-\s*DEMANDA\s*-\s*SEM ICMS\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\/(\d{2}|20\d{2})$/.exec(label);
  if(!demand&&!subsidy||demand&&Number(demand[1].replace(',','.'))>100)return row;
  const month=demand?.[2]??subsidy![1],year=demand?.[3]??subsidy![2];
  if((year.length===2?'20':'')+year+'-'+String(months.indexOf(month)+1).padStart(2,'0')!==reference)return row;
  const amount=row.fields.amount?.decimal,missing=['unit','quantity','aneelRate','grossRate'];
  if(typeof amount!=='string'||!/^(0|[1-9]\d{0,11})\.\d{2}$/.test(amount)||!verified(row.fields.description)||!verified(row.fields.amount)||missing.some(k=>row.fields[k]?.text.trim()))return row;
  for(const key of ['icmsBase','icmsAmount','icmsRate']){const f=row.fields[key];if(f?.text.trim()&&(!/^0(?:\.0+)?$/.test(f.decimal??'')||!verified(f)))return row;}
  if(['pisAmount','cofinsAmount'].some(k=>row.fields[k]?.text.trim()&&(!/^(0|[1-9]\d{0,11})\.\d{2}$/.test(row.fields[k].decimal??'')||!verified(row.fields[k]))))return row;
  const component=demand?'DEMAND_CONTRACT_DIFFERENCE':'TARIFF_SUBSIDY';
  proofs.push({source:row.source,component,reference,amount,unprintedFields:missing});
  return {...row,component,role:'CHARGE' as const,issues:[...row.issues.filter(i=>i!=='UNMAPPED_COMPONENT'),'DOCUMENTED_AMOUNT_ONLY_BILLING']};
 });
 return {operations,proofs};
}
