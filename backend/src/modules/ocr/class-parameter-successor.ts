/** Resolve only an approved class-completion successor with unchanged financial evidence. */
export function classSuccessorId(id:string,rows:any[]):string {
 const old=rows.find(p=>p.id===id);if(!old||old.status!=='RETIRED')return id;
 const next=rows.filter(p=>p.supersedes_parameter_id===id&&p.status==='APPROVED');if(next.length!==1)return id;const n=next[0];
 const keys=['organization_id','customer_id','consumer_unit_id','kind','component_code','scenario','time_band','measure','amount_text','treatment','included_taxes','base_rule','direction','source','start_date','end_date','monetary_source'];
 if(keys.some(k=>(old[k]??null)!==(n[k]??null))||JSON.stringify(old.embedded_tax_codes??[])!==JSON.stringify(n.embedded_tax_codes??[])||!old.unit_context||!n.unit_context||old.unit_context.consumption_class!=null||!n.unit_context.consumption_class||!Number.isInteger(n.revision)||n.revision<1)return id;
 const contextKeys=new Set([...Object.keys(old.unit_context),...Object.keys(n.unit_context)]);for(const k of contextKeys)if(k!=='consumption_class'&&(old.unit_context[k]??null)!==(n.unit_context[k]??null))return id;
 if(old.kind==='TAX'){
  if(old.tax_basis?.version!==1||n.tax_basis?.version!==1||Object.keys(old.tax_basis).length!==2||Object.keys(n.tax_basis).length!==2||!Array.isArray(old.tax_basis.items)||!Array.isArray(n.tax_basis.items)||old.tax_basis.items.length!==n.tax_basis.items.length)return id;
  if(!old.tax_basis.items.every((i:any)=>{const source=rows.find(p=>p.id===i.parameterId);if(!source||source.kind!=='TARIFF')return false;const resolved=classSuccessorId(i.parameterId,rows),base=rows.find(p=>p.id===resolved);return n.tax_basis.items.some((j:any)=>j.parameterId===resolved&&j.revision===base?.revision&&j.operation===i.operation);}))return id;
 }else if(old.kind!=='TARIFF'||old.tax_basis||n.tax_basis)return id;
 return n.id;
}
export function classReviewedBasis(basis:any,rows:any[]){if(!basis?.items)return basis;return {...basis,items:basis.items.map((i:any)=>{const id=classSuccessorId(i.parameterId,rows);return id===i.parameterId?i:{...i,parameterId:id,revision:rows.find(p=>p.id===id)?.revision};})};}
