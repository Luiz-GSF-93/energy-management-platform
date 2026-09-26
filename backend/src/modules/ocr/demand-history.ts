export function demandHistory(rows:any[]|null,doc:any){
 const empty={canImport:false,state:'UNAVAILABLE',periods:[] as any[],message:'Histórico contratual indisponível.'};
 const month=String(doc.reference_month??'').slice(0,7);if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)||!Array.isArray(rows)||rows.length>500||rows.some(r=>r.organization_id!==doc.organization_id||r.consumer_unit_id!==doc.consumer_unit_id||r.customer_id!==doc.customer_id))return empty;
 const replaced=new Set(rows.map(r=>r.supersedes_id).filter(Boolean));const start=month+'-01',end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);
 const active=rows.filter(r=>!replaced.has(r.id)&&r.start_date<=end&&r.end_date>=start).sort((a,b)=>a.start_date.localeCompare(b.start_date));
 const periods=active.map(r=>({id:r.id,start:r.start_date,end:r.end_date,modality:r.modality,single:r.single_kw,peak:r.peak_kw,offPeak:r.off_peak_kw,document:r.document_name,reason:r.reason}));
 if(!active.length)return {...empty,state:'MISSING',message:'Nenhuma vigência contratual registrada para esta competência.'};
 let day=start,gap=false;for(const p of active){if(p.start_date>day)gap=true;if(p.end_date>=day){const d=new Date(p.end_date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);day=d.toISOString().slice(0,10);}}if(day<=end)gap=true;
 return {canImport:false,periods,state:gap?'GAP':active.length>1?'SPLIT':'COVERED_REFERENCE',message:gap?'Há dias sem vigência registrada. Complete o histórico.':active.length>1?'Há mais de uma vigência no mês. A apuração exige tratar os períodos separadamente.':'Vigência registrada cobre a competência. Documento e enquadramento ainda exigem validação; não é aprovação financeira.'};
}
export async function loadDemandHistory(db:any,doc:any){try{const r=await db.from('unit_demand_periods').select('*').eq('organization_id',doc.organization_id).eq('customer_id',doc.customer_id).eq('consumer_unit_id',doc.consumer_unit_id).order('start_date').limit(501);return demandHistory(r.error?null:r.data,doc);}catch{return demandHistory(null,doc);}}
