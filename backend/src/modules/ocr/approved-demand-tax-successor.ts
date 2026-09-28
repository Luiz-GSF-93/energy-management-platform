/** Read-only recognition of the approved six-base successor; never changes approval eligibility. */
export function approvedDemandTaxSuccessor(previous:any,rows:any[],baseItems:any[]){
 if(!previous||previous.status!=='RETIRED'||baseItems.length!==4)return null;
 const scope=(p:any)=>p&&['organization_id','customer_id','consumer_unit_id','scenario','start_date','end_date'].every(k=>p[k]===previous[k]);
 const active=rows.filter(p=>p.kind==='TAX'&&p.component_code===previous.component_code&&p.status!=='RETIRED'&&p.start_date<=previous.end_date&&p.end_date>=previous.start_date);
 if(active.length!==1)return null;const n=active[0],items=n.tax_basis?.items;
 if(!scope(n)||n.status!=='APPROVED'||n.supersedes_parameter_id!==previous.id||n.source!==previous.source+' · versão ampliada do parâmetro '+previous.id||n.treatment!=='INCLUDED'||n.measure!=='PERCENT'||n.time_band!=='ALL'||n.direction!=='DEBIT'||n.amount_text!==null||n.monetary_source||n.embedded_tax_codes?.length||!Number.isInteger(n.revision)||n.revision<1||n.tax_basis?.version!==1||Object.keys(n.tax_basis).length!==2||!Array.isArray(items)||items.length!==6||new Set(items.map((i:any)=>i?.parameterId)).size!==6)return null;
 if(!baseItems.every(i=>items.some((j:any)=>j.parameterId===i.parameterId&&j.revision===i.revision&&j.operation==='INCLUDE')))return null;
 const demand=new Set<string>();
 for(const item of items){
  if(!item||Object.keys(item).length!==3)return null;const matches=rows.filter(p=>p.id===item.parameterId),p=matches[0];
  if(matches.length!==1||!scope(p)||p.kind!=='TARIFF'||p.status!=='APPROVED'||p.revision!==item.revision||p.treatment!=='GROSS'||p.direction!=='DEBIT'||!Array.isArray(p.embedded_tax_codes))return null;
  if(baseItems.some(i=>i.parameterId===item.parameterId))continue;
  if(!['TUSD_DEMAND_USED','TUSD_DEMAND_UNUSED'].includes(p.component_code)||p.time_band!=='ALL'||p.measure!=='BRL_KW')return null;
  const operation=p.embedded_tax_codes.includes(n.component_code)?'INCLUDE':'EXCLUDE';
  if(item.operation!==operation||(operation==='EXCLUDE'&&(p.component_code!=='TUSD_DEMAND_UNUSED'||n.component_code!=='ICMS')))return null;
  demand.add(p.component_code);
 }
 return demand.size===2?{id:n.id,status:n.status,revision:n.revision,linkedBaseCount:items.length}:null;
}
