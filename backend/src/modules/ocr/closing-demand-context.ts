/** Apply only an approved, document-bound demand period covering the whole competence.
 * The registered unit and historical records remain unchanged. */
export function closingDemandContext(context:any,tables:any,month:string){
 if(!context?.unit||context.closingDemandSource?.kind==='INVOICE_CONTRACTED_DEMAND')return context;
 const unit=context.unit,start=month+'-01',end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
 const periods=(tables?.unit_demand_periods??[]).filter((p:any)=>p.organization_id===unit.organization_id&&p.customer_id===unit.customer_id&&p.consumer_unit_id===unit.id);
 const eligible=periods.filter((p:any)=>p.start_date<=start&&p.end_date>=end&&!periods.some((n:any)=>n.supersedes_id===p.id)&&(tables.unit_demand_approvals??[]).some((a:any)=>a.period_id===p.id&&a.organization_id===unit.organization_id&&a.customer_id===unit.customer_id&&a.consumer_unit_id===unit.id)&&(tables.documents??[]).some((d:any)=>d.id===p.document_id&&d.organization_id===unit.organization_id&&d.customer_id===unit.customer_id&&d.consumer_unit_id===unit.id&&d.file_verified===true&&d.file_hash===p.document_hash));
 if(eligible.length!==1)return context;
 const p=eligible[0],positive=(v:any)=>typeof v==='string'&&/^\d+(?:\.\d{1,6})?$/.test(v)&&Number(v)>0;
 if(p.modality==='GREEN'&&!positive(p.single_kw)||p.modality==='BLUE'&&(!positive(p.peak_kw)||!positive(p.off_peak_kw))||!['GREEN','BLUE'].includes(p.modality))return context;
 return {...context,unit:{...unit,...(p.modality==='GREEN'?{contracted_demand:p.single_kw}:{contracted_demand_peak:p.peak_kw,contracted_demand_off_peak:p.off_peak_kw})},closingDemandSource:{id:p.id,documentId:p.document_id,hash:p.document_hash,from:p.start_date,to:p.end_date}};
}
