export type CostAbsenceReference={id:string;scenario:'ACL'|'ACR';version:number;source:string;reason:string;createdBy:string;createdAt:string};
const keys=['distributor','tariff_group','tariff_subgroup','tariff_modality','state','free_market'];
export function currentCostRows(unit:any,month:string,rows:any[]){return rows.filter(r=>r.organization_id===unit.organization_id&&r.customer_id===unit.customer_id&&r.consumer_unit_id===unit.id&&r.month===month).sort((a,b)=>b.version-a.version);}
/** Declaration is an independent reviewed source, never approval of the cost draft. */
export function costAbsences(unit:any,month:string,costRows:any[],rows:any[]):CostAbsenceReference[]{
 const costs=currentCostRows(unit,month,costRows),latest=costs[0];
 const relevant=[latest,costs.find(r=>r.status==='VALIDATED')].filter(Boolean);
 return (['ACR','ACL'] as const).flatMap(scenario=>{
  const scoped=rows.filter(r=>r.organization_id===unit.organization_id&&r.customer_id===unit.customer_id&&r.consumer_unit_id===unit.id&&r.month===month&&r.scenario===scenario).sort((a,b)=>b.version-a.version),r=scoped[0];
  if(!r||r.absent!==true||!r.id||!Number.isInteger(r.version)||r.version<1||scoped.filter(x=>x.version===r.version).length!==1||!r.created_by?.trim()||!r.created_at||!r.source_reference?.trim()||typeof r.reason!=='string'||r.reason.trim().length<20)return [];
  if((r.cost_id??null)!==(latest?.id??null)||(r.cost_revision??null)!==(latest?.revision??null)||!r.unit_context||keys.some(k=>(r.unit_context[k]??null)!==(unit[k]??null)))return [];
  if(relevant.some(c=>!Array.isArray(c.costs?.items)||c.costs.items.some((i:any)=>!['ACL','ACR'].includes(i.scenario)||i.scenario===scenario&&!['SUPPLIER_INVOICE','SUPPLIER_EXTRA_ENERGY'].includes(i.category))))return [];
  return [{id:r.id,scenario,version:r.version,source:r.source_reference,reason:r.reason,createdBy:r.created_by,createdAt:r.created_at}];
 });
}
