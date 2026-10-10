type AuditRecord = Record<string, any>;
const fields = ['created_by','updated_by','validated_by','actor_id','responsible_id','reviewed_by','createdBy','actorId','reviewerId','actor'] as const;
const label = (v: unknown): string | null => typeof v === 'string' && v.trim() && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(v.trim()) && !['consultor','administrador da plataforma','administrador da organização','gestor','operador','operacional','consulta','eu'].includes(v.trim().toLowerCase()) ? v.trim().slice(0,200) : null;
export type AuditIdentity = {id:string;recordedName:string|null;currentName:string|null;lookup:'AVAILABLE'|'MISSING'|'UNAVAILABLE';currentRole:string|null;currentAffiliation:string|null;currentCustomer:{id:string;name:string|null}|null};
/** Read projection only. Never infer past roles from today's membership or change signed bodies. */
export async function auditAuthorNames(client:any, organizationId:string, rows:AuditRecord[], options:{includeContext?:boolean}={}):Promise<AuditRecord[]> {
 const records=rows.filter(r=>r.organization_id===organizationId).flatMap(r=>[r,...(r.snapshot?.organization_id===organizationId?[r.snapshot]:[])]);
 const ids=[...new Set<string>(records.flatMap(r=>fields.map(k=>r[k]).filter(id=>typeof id==='string'&&id.length>0)))];
 const directory=new Map<string,AuditIdentity>(),members=new Map<string,any>(),customerIds=new Set<string>(records.map(r=>r.customer_id).filter(Boolean));
 const context=options.includeContext!==false;
 for(let i=0;i<ids.length;i+=100){
  const batch=ids.slice(i,i+100),allowed=new Set(batch);let unavailable=false;
  for(const id of batch)directory.set(id,{id,recordedName:null,currentName:null,lookup:'MISSING',currentRole:null,currentAffiliation:null,currentCustomer:null});
  try {const r=await client.from('organization_members').select(context?'user_id,organization_id,display_name,affiliation_type,exclusive_customer_id,roles(name)':'user_id,organization_id,display_name').eq('organization_id',organizationId).in('user_id',batch);
   if(r.error||!Array.isArray(r.data))unavailable=true;else for(const m of r.data)if(m.organization_id===organizationId&&allowed.has(m.user_id)){
    const v=directory.get(m.user_id)!;v.currentName=label(m.display_name);v.lookup=v.currentName?'AVAILABLE':'MISSING';members.set(m.user_id,m);
    if(context){const role=Array.isArray(m.roles)?m.roles[0]:m.roles;v.currentRole=typeof role?.name==='string'?role.name:null;v.currentAffiliation=['internal','external'].includes(m.affiliation_type)?m.affiliation_type:null;}
   }
  }catch{unavailable=true;}
  const missing=batch.filter(id=>!directory.get(id)?.currentName);
  if(missing.length)try{const p=await client.from('user_profiles').select('user_id,name').in('user_id',missing);
   if(p.error||!Array.isArray(p.data))unavailable=true;else for(const m of p.data)if(missing.includes(m.user_id)){const v=directory.get(m.user_id)!;v.currentName=label(m.name);v.lookup=v.currentName?'AVAILABLE':'MISSING';}
  }catch{unavailable=true;}
  if(unavailable)for(const id of batch){const v=directory.get(id)!;if(!v.currentName)v.lookup='UNAVAILABLE';}
 }
 const companies=new Map<string,string>();
 if(context){const list=[...customerIds];for(let i=0;i<list.length;i+=100)try{const allowed=new Set(list.slice(i,i+100));const r=await client.from('customers').select('id,organization_id,company_name').eq('organization_id',organizationId).in('id',[...allowed]);if(!r.error&&Array.isArray(r.data))for(const c of r.data)if(c.organization_id===organizationId&&allowed.has(c.id)&&label(c.company_name))companies.set(c.id,label(c.company_name)!);}catch{/* Directory decoration must not invalidate the record. */}}
 const enrich=(row:AuditRecord,parentAuthorized=true):AuditRecord=>{
  const authorized=parentAuthorized&&row.organization_id===organizationId,auditIdentities:Record<string,AuditIdentity>={};
  for(const key of fields){const id=row[key],v=authorized?directory.get(id):undefined;if(!v)continue;
   const raw=key==='created_by'?row.requested_by_name??(!row.actor_id?row.actor_name:null):key==='actor_id'||key==='actorId'?row.actor_name??row.actorName:key==='validated_by'||key==='reviewed_by'?row.actor_name:key==='createdBy'?row.actorName:key==='reviewerId'?row.reviewerName:null;
   const member=members.get(id),customer=member?.exclusive_customer_id;
   auditIdentities[key]={...v,recordedName:raw===id?null:label(raw),currentCustomer:context&&customer&&customer===row.customer_id?{id:customer,name:companies.get(customer)??null}:null};
  }
  return {...row,...Object.fromEntries(fields.filter(k=>k!=='actor').map(k=>[k+'_name',authorized?directory.get(row[k])?.currentName??null:null])),auditIdentities,...(authorized&&context&&row.customer_id?{auditCompany:{id:row.customer_id,currentName:companies.get(row.customer_id)??null}}:{})};
 };
 return rows.map(row=>({...enrich(row),...(row.snapshot&&typeof row.snapshot==='object'?{snapshot:enrich(row.snapshot,row.organization_id===organizationId)}:{})}));
}
