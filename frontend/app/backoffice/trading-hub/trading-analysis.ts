export type TradingRow={id:string;kind:string;parent_id:string|null;status:string;data:Record<string,any>;created_at:string};
export const purchaseLabels:Record<string,string>={AVULSA:'Avulsa · compra bilateral',CONTRATO:'Contrato',UNKNOWN:'Não informado'};
export const termLabels:Record<string,string>={SHORT:'Curto · 1–6 meses',MEDIUM:'Médio · 7–11 meses',LONG:'Longo · 12+ meses',UNKNOWN:'Prazo não informado'};
export function termBand(months:unknown){return typeof months!=='number'||!Number.isInteger(months)||months<1?'UNKNOWN':months<=6?'SHORT':months<12?'MEDIUM':'LONG';}
export function monthIndex(value:unknown){if(typeof value!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(value))return null;return Number(value.slice(0,4))*12+Number(value.slice(5))-1;}
export function monthValue(index:number){return `${Math.floor(index/12)}-${String(index%12+1).padStart(2,'0')}`;}
export type Observation={proposal:TradingRow;opportunity:TradingRow;supplier:TradingRow;price:number;start:number;end:number;purchase:string;band:string;variation:number|null;difference:number|null};
/** Only joins rows already authorized by the organization's existing Trading endpoint. */
export function observations(rows:TradingRow[],receivedIds:Set<string>):Observation[]{
 const byId=new Map(rows.map(r=>[r.id,r]));const result:Observation[]=[];
 for(const proposal of rows){
  if(proposal.kind!=='proposal'||!receivedIds.has(proposal.id)||!['RECEIVED','ANALYSIS','MANAGER_APPROVED','CLIENT_APPROVED','CONTRACTED'].includes(proposal.status))continue;
  const opportunity=byId.get(proposal.parent_id??''),supplier=byId.get(proposal.data.supplierId);
  if(!opportunity||opportunity.kind!=='opportunity'||!supplier||supplier.kind!=='supplier'||proposal.data.energyType!==opportunity.data.energyType)continue;
  const start=monthIndex(opportunity.data.startMonth),band=termBand(opportunity.data.months),price=proposal.data.priceBrlMwh;
  if(start===null||band==='UNKNOWN'||typeof price!=='number'||!Number.isFinite(price)||price<=0||!Number.isFinite(Date.parse(proposal.created_at)))continue;
  result.push({proposal,opportunity,supplier,price,start,end:start+opportunity.data.months-1,purchase:['AVULSA','CONTRATO'].includes(opportunity.data.purchaseType)?opportunity.data.purchaseType:'UNKNOWN',band,variation:null,difference:null});
 }
 result.sort((a,b)=>Date.parse(a.proposal.created_at)-Date.parse(b.proposal.created_at)||a.proposal.id.localeCompare(b.proposal.id));
 const previous=new Map<string,number>();
 for(const row of result){const d=row.proposal.data;const key=JSON.stringify([row.opportunity.id,row.supplier.id,d.energyType,d.flexibility,d.modulation,d.guarantees,d.conditions]);const last=previous.get(key);row.variation=last===undefined?null:(row.price/last-1)*100;row.difference=last===undefined?null:row.price-last;previous.set(key,row.price);}
 return result;
}
export function filterObservations(rows:Observation[],f:{purchase:string;band:string;supplier:string;submarket:string;energy:string;from:string;to:string}){
 const from=monthIndex(f.from),to=monthIndex(f.to);
 if(from!==null&&to!==null&&from>to)return [];
 return rows.filter(r=>(!f.purchase||r.purchase===f.purchase)&&(!f.band||r.band===f.band)&&(!f.supplier||r.supplier.id===f.supplier)&&(!f.submarket||r.opportunity.data.submarket===f.submarket)&&(!f.energy||r.proposal.data.energyType===f.energy)&&(from===null||r.end>=from)&&(to===null||r.start<=to));
}
