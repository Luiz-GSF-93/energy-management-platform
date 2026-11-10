import {electricalField} from './electrical-evidence';
import {globalFieldEvidence} from './eva-global-model';

const list=(v:any):any[]=>Array.isArray(v)?v:[];
const norm=(v:unknown)=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
function box(v:any){const p=v?.polygon;if(!Array.isArray(p)||p.length!==8||p.some(n=>typeof n!=='number'||!Number.isFinite(n)))return null;const xs=p.filter((_,i)=>i%2===0),ys=p.filter((_,i)=>i%2===1);const b={left:Math.min(...xs),right:Math.max(...xs),top:Math.min(...ys),bottom:Math.max(...ys)};return b.right>b.left&&b.bottom>b.top?b:null;}
/** Explicit first-page contracted-quantity panel. Never derive the contract
 * from billed shares, meter readings, charts or an amount divided by a tariff. */
export function invoiceDemandReference(c:any){
 const d=c?.document??c?.source?.doc,u=c?.unit,raw=c?.source?.raw,layout=c?.layout;
 if(!u||!d||d.organization_id!==u.organization_id||d.customer_id!==u.customer_id||d.consumer_unit_id!==u.id||!d.file_verified||String(d.reference_month).slice(0,7)!==c.month||c.originalIdentity?.state!=='MATCH'||c.originalIdentity.fileHash!==d.file_hash||!['cpfl-paulista-a'].includes(layout?.layoutId)||!['GREEN','BLUE'].includes(u.tariff_modality))return null;
 const page=list(raw?.pages).filter(p=>p.pageNumber===1);if(page.length!==1)return null;
 const lines=list(page[0].lines),panels=lines.filter(l=>norm(l.content)==='GRANDEZAS CONTRATADAS');if(panels.length!==1)return null;
 const panel=box(panels[0]);if(!panel)return null;
 const field=(l:any,numeric=false)=>electricalField(raw,{...l,boundingRegions:[{pageNumber:1}]},numeric);
 if(!globalFieldEvidence(raw,field(panels[0])).filled)return null;
 const labels=u.tariff_modality==='GREEN'?[['ALL',/^DEMANDA KW$/]]:[['PEAK',/^DEMANDA PONTA KW$/],['OFF_PEAK',/^DEMANDA FORA (?:DE )?PONTA KW$/]];
 const values:any[]=[];
 for(const [band,re] of labels){
  const rows=lines.filter(l=>(re as RegExp).test(norm(l.content))).filter(l=>{const b=box(l);return b&&b.top>=panel.bottom&&b.top-panel.bottom<=(panel.bottom-panel.top)*6&&b.left>=panel.left-(panel.right-panel.left)/2;});
  if(rows.length!==1)return null;const label=rows[0],b=box(label)!;
  const candidates=lines.filter(l=>{const x=box(l);return x&&x.left>b.right&&x.right<=panel.right+(panel.right-panel.left)/2&&Math.abs((x.top+x.bottom-b.top-b.bottom)/2)<=Math.max(x.bottom-x.top,b.bottom-b.top)*0.6;}).map(l=>({line:l,value:field(l,true)})).filter(x=>x.value.decimal!==null&&/^\d+(?:\.\d{1,6})?$/.test(x.value.decimal)&&Number(x.value.decimal)>0);
  if(candidates.length!==1||!globalFieldEvidence(raw,field(label)).filled||!globalFieldEvidence(raw,candidates[0].value).filled)return null;
  values.push({band,amount:candidates[0].value.decimal,source:'pages[0].lines['+lines.indexOf(candidates[0].line)+']',pages:[1],spans:candidates[0].value.spans,confidence:globalFieldEvidence(raw,candidates[0].value).confidence});
 }
 return {kind:'INVOICE_CONTRACTED_DEMAND',documentId:d.id,hash:d.file_hash,month:c.month,values,reviewRequired:true,registered:{single:u.contracted_demand??null,peak:u.contracted_demand_peak??null,offPeak:u.contracted_demand_off_peak??null}};
}

/** Monthly evidence is local to the proposal; the current registration and
 * already published history are never rewritten by an invoice extraction. */
export function withInvoiceDemand(c:any){
 const proof=invoiceDemandReference(c);if(!proof)return c;
 const fields=Object.fromEntries(proof.values.map(v=>[v.band==='ALL'?'contracted_demand':v.band==='PEAK'?'contracted_demand_peak':'contracted_demand_off_peak',v.amount]));
 return {...c,unit:{...c.unit,...fields},closingDemandSource:proof};
}
