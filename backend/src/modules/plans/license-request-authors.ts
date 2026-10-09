type RequestRow={organization_id:string;requested_by:string;[key:string]:any};
/** Current directory labels for actors in an already-authorized request set; no ledger rewrite. */
export async function licenseRequestAuthors(client:any,rows:RequestRow[],organizationId?:string){
 const allowed=rows.filter(r=>typeof r.organization_id==='string'&&typeof r.requested_by==='string'&&(!organizationId||r.organization_id===organizationId));
 const allowedRows=new Set(allowed);
 const key=(org:string,user:string)=>JSON.stringify([org,user]);
 const pairs=new Set(allowed.map(r=>key(r.organization_id,r.requested_by))),names=new Map<string,string>(),affiliations=new Map<string,string>();
 const label=(value:unknown)=>typeof value==='string'&&value.trim()?value.trim().slice(0,200):null;
 for(let start=0;start<allowed.length;start+=100){
  const batch=allowed.slice(start,start+100),orgs=[...new Set(batch.map(r=>r.organization_id))],users=[...new Set(batch.map(r=>r.requested_by))];
  try{const r=await client.from('organization_members').select('user_id,organization_id,display_name,affiliation_type').in('organization_id',orgs).in('user_id',users);if(!r.error&&Array.isArray(r.data))for(const m of r.data){const pair=key(m.organization_id,m.user_id);if(!pairs.has(pair)||!orgs.includes(m.organization_id)||!users.includes(m.user_id))continue;const name=label(m.display_name);if(name)names.set(pair,name);if(['internal','external'].includes(m.affiliation_type))affiliations.set(pair,m.affiliation_type);}}
  catch{/* Directory failures do not hide an authorized pending request. */}
  const missing=users.filter(user=>batch.some(r=>r.requested_by===user&&!names.has(key(r.organization_id,user))));
  if(!missing.length)continue;
  try{const r=await client.from('user_profiles').select('user_id,name').in('user_id',missing);if(!r.error&&Array.isArray(r.data))for(const p of r.data){if(!missing.includes(p.user_id))continue;const name=label(p.name);if(name)for(const row of batch.filter(row=>row.requested_by===p.user_id)){const pair=key(row.organization_id,p.user_id);if(!names.has(pair))names.set(pair,name);}}}
  catch{/* Preserve actor IDs and explicit missing labels. */}
 }
 return rows.map(r=>({...r,requested_by_name:allowedRows.has(r)?names.get(key(r.organization_id,r.requested_by))??null:null,requested_by_affiliation:allowedRows.has(r)?affiliations.get(key(r.organization_id,r.requested_by))??null:null}));
}
