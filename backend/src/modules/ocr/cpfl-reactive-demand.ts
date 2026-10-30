import type {CpflOperation} from './cpfl-paulista-layout';
/** Derived alias for printed reactive demand. Does not derive active demand or taxes. */
export function cpflReactiveDemand(rows:CpflOperation[],reference:string,verified:(field:any)=>boolean){
 const months=['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
 return rows.map(row=>{
  if(row.role!=='UNKNOWN'||row.component!=='OTHER'||row.issues.some(i=>['MERGED_OR_DUPLICATE_CELL','UNMAPPED_COLUMN','UNVERIFIED_SOURCE'].includes(i)))return row;
  const label=String(row.fields.description?.text??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();
  const match=/^DEM REAT EXC FDR USD\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\/(\d{2}|20\d{2})$/.exec(label);
  if(!match||(match[2].length===2?'20':'')+match[2]+'-'+String(months.indexOf(match[1])+1).padStart(2,'0')!==reference)return row;
  if(String(row.fields.unit?.text??'').trim().toUpperCase()!=='KW'||!['description','unit','quantity','aneelRate','grossRate','amount'].every(k=>verified(row.fields[k])&& (k==='description'||k==='unit'||/^(0|[1-9]\d{0,11})(?:\.\d{1,8})?$/.test(row.fields[k]?.decimal??'')))||row.arithmetic.state!=='MATCH_WITHIN_ONE_CENT')return row;
  return {...row,component:'REACTIVE_DEMAND',role:'CHARGE' as const,issues:[...row.issues.filter(i=>i!=='UNMAPPED_COMPONENT'),'DOCUMENTED_REACTIVE_DEMAND']};
 });
}
