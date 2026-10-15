module.exports=async({db,id,ok,deny,partSet})=>{
 const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
 const {prepareComposite}=require('../dist/modules/ocr/eva-composite.model');
 const root=path.join(__dirname,'../src/database/migrations');
 await db.exec(fs.readFileSync(root+'/20261030_eva_search_execution.sql','utf8'));
 await db.exec(`CREATE TABLE organizations(id text PRIMARY KEY,deleted_at timestamptz);CREATE TABLE organization_members(organization_id text,user_id uuid,role_id uuid,status text);CREATE TABLE platform_organization_sessions(organization_id text,user_id uuid,expires_at timestamptz,revoked_at timestamptz);
 CREATE FUNCTION bot_energy_license_quota(text) RETURNS bigint LANGUAGE sql AS $$SELECT CASE WHEN $1='org_default' THEN 10000000::bigint ELSE 0 END$$;
 INSERT INTO organizations VALUES('org_default',null),('other',null);
 INSERT INTO roles VALUES('${id(9000)}','organization','admin_org','org_default','["62443ab1-9187-42e4-a932-a7cf54f76250"]');
 INSERT INTO organization_members VALUES('org_default','${id(9001)}','${id(9000)}','ACTIVE');`);
 await db.exec(fs.readFileSync(root+'/20261105_eva_corpus_publication.sql','utf8'));
 const before=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(x=>x.tablename);
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261107_eva_composite_publication.sql'),'utf8'));
 const after=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(x=>x.tablename);
 assert.deepEqual(after.filter(x=>!before.includes(x)),['eva_composite_release_batches','eva_composite_release_events','eva_composite_releases']);ok(true);
 for(const t of after.filter(x=>!before.includes(x))){const r=(await db.query('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass',[t])).rows[0];ok(r.relrowsecurity&&r.relforcerowsecurity);for(const role of ['anon','authenticated','service_role'])for(const p of ['SELECT','INSERT','UPDATE','DELETE'])ok(!(await db.query('SELECT has_table_privilege($1,$2,$3) AS p',[role,t,p])).rows[0].p);}
 const rpc=(actor,action,key,body)=>db.query('SELECT eva_composite_action($1,$2,$3,$4) AS data',[actor,action,key,JSON.stringify(body)]).then(r=>r.rows[0].data);
 const filter={page:0,search:'',state:''};await deny(()=>rpc(null,'list',null,filter),'42501');await deny(()=>rpc(id(2),'list',null,filter),'42501');await deny(()=>rpc(id(88888),'candidate',partSet.id,{}),'42501');
 ok((await rpc(id(1),'list',null,filter)).total===0);
 const source=await rpc(id(1),'candidate',partSet.id,{});ok(source.pages===101&&source.parts.length===3);
 const plan=prepareComposite(source);ok(plan.manifest.chunkTotal===101&&plan.batches.length===2&&plan.batches[0].chunks.length===100&&plan.batches[1].chunks[0].page===101);
 const body={requestId:id(60000),setId:partSet.id,expectedManifestHash:source.manifestHash,justification:'Synthetic composite coverage and permissions test only.',...plan};
 for(const mutate of [x=>x.manifest.originalPageCount++,x=>x.batches[0].chunks[0].page++,x=>x.batches[0].chunks[0].text='untrusted substitution',x=>x.batches[0].chunks.shift(),x=>x.batches[0].chunks.reverse()]){
  const b=JSON.parse(JSON.stringify(body));mutate(b);let e;try{await rpc(id(1),'prepare',null,b)}catch(x){e=x}assert(e&&['22023','23505'].includes(e.code),(e?.message||'Expected rejection')+' '+(e?.internalQuery||''));ok(true);ok((await rpc(id(1),'list',null,filter)).total===0);
 }
 const prepared=await rpc(id(1),'prepare',null,body);ok(prepared.state==='DRAFT'&&prepared.chunks===101&&prepared.batches===2&&!prepared.published);
 ok((await rpc(id(1),'prepare',null,body)).replayed===true);
 const preview=await rpc(id(1),'preview',prepared.id,{page:10});ok(preview.rows.length===1&&preview.rows[0].page===101&&preview.total===101);await deny(()=>rpc(id(2),'preview',prepared.id,{page:0}),'42501');
 await deny(()=>rpc(id(3),'prepare',null,body),'23505');
 let detail=await rpc(id(1),'detail',prepared.id,{page:0,batchPage:0});ok(detail.originCurrent&&detail.batches.length===2&&!detail.published);
 const decision=(n,d)=>({requestId:id(n),expectedEventId:d.eventId,justification:'Synthetic independent composite decision for SQL testing.'});
 await deny(()=>rpc(id(1),'review',prepared.id,decision(60001,detail)),'42501');
 await rpc(id(3),'review',prepared.id,decision(60002,detail));detail=await rpc(id(1),'detail',prepared.id,{page:0,batchPage:0});ok(detail.state==='APPROVED_PRIVATE');
 const claimBody={...decision(60003,detail),batchId:detail.batches[0].id,phase:'INDEX',tokenLimit:10000};
 let claim;
 if(process.env.EVA_COMPOSITE_TEST_PG_PORT){
  const plans=[claimBody,{...claimBody,requestId:id(60030)}],race=await Promise.allSettled(plans.map(b=>rpc(id(1),'claim',prepared.id,b)));
  ok(race.filter(r=>r.status==='fulfilled').length===1);ok(race.filter(r=>r.status==='rejected'&&r.reason.code==='23505').length===1);
  const winner=race.findIndex(r=>r.status==='fulfilled');claim=race[winner].value;claimBody.requestId=plans[winner].requestId;
 }else claim=await rpc(id(1),'claim',prepared.id,claimBody);
 ok(claim.chunks.length===100&&!claim.readOnly&&claim.phase==='INDEX');
 ok((await rpc(id(1),'claim',prepared.id,claimBody)).replayed);
 const send=(n,kind,chunkId)=>rpc(id(1),'send',prepared.id,{requestId:id(n),batchId:claim.batchId,leaseId:claim.leaseId,kind,chunkId});
 await send(60100,'EMBEDDING',claim.chunks[0].id);await deny(()=>send(60101,'EMBEDDING',claim.chunks[0].id),'23505');
 await deny(()=>rpc(id(3),'send',prepared.id,{requestId:id(60102),batchId:claim.batchId,leaseId:claim.leaseId,kind:'LOOKUP_AFTER',chunkId:claim.chunks[0].id}),'42501');
 await deny(()=>send(60103,'MERGE',claim.chunks[0].id),'23505');
 await rpc(id(1),'embedded',prepared.id,{requestId:id(60104),batchId:claim.batchId,leaseId:claim.leaseId,chunkId:claim.chunks[0].id,vector:Array(1536).fill(.1),tokens:5});
 await send(60105,'INDEX',claim.chunks[0].id);await send(60106,'LOOKUP_AFTER',claim.chunks[0].id);
 await rpc(id(1),'verified',prepared.id,{requestId:id(60107),batchId:claim.batchId,leaseId:claim.leaseId,chunkId:claim.chunks[0].id});
 // Even a dishonest confirmed=true cannot activate a batch with 99 missing receipts.
 const incomplete=await rpc(id(1),'finish',prepared.id,{requestId:id(60108),batchId:claim.batchId,leaseId:claim.leaseId,confirmed:true,elapsedMs:10});ok(incomplete.state==='UNKNOWN'&&!incomplete.published);
 detail=await rpc(id(1),'detail',prepared.id,{page:0,batchPage:0});const recovery=await rpc(id(3),'reconcile',prepared.id,{...decision(60109,detail),batchId:claim.batchId});ok(recovery.readOnly&&recovery.phase==='INDEX');
 await deny(()=>rpc(id(3),'send',prepared.id,{requestId:id(60110),batchId:recovery.batchId,leaseId:recovery.leaseId,kind:'EMBEDDING',chunkId:claim.chunks[1].id}),'23505');
 detail=await rpc(id(1),'detail',prepared.id,{page:0,batchPage:0});await rpc(id(1),'quarantine',prepared.id,decision(60111,detail));
 // A fresh immutable set review creates a new candidate; the old release stays quarantined.
 const partReview=await db.query('SELECT eva_document_parts_action($1,$2,$3,$4) AS data',[id(3),'review',partSet.id,JSON.stringify({requestId:id(61000),expectedSetId:partSet.id,justification:'New synthetic immutable set review for complete transport tests.'})]);
 const nextSource=await rpc(id(1),'candidate',partReview.rows[0].data.id,{}),nextPlan=prepareComposite(nextSource);
 const ready=await rpc(id(1),'prepare',null,{...body,requestId:id(62000),setId:nextSource.setId,expectedManifestHash:nextSource.manifestHash,...nextPlan});
 let seq=63000;const next=()=>id(seq++);const view=()=>rpc(id(1),'detail',ready.id,{page:0,batchPage:0});
 detail=await view();await rpc(id(3),'review',ready.id,{...decision(62001,detail)});
 for(const phase of ['INDEX','PUBLISH']){
  detail=await view();ok(!detail.published);
  for(const batch of detail.batches){
   const current=await view(),c=await rpc(id(1),'claim',ready.id,{requestId:next(),expectedEventId:current.eventId,justification:'Complete synthetic transport proof, no real provider calls.',batchId:batch.id,phase,tokenLimit:phase==='INDEX'?10000:null});
   ok(c.chunks.length<=100);const internal=(action,fields)=>rpc(id(1),action,ready.id,{requestId:next(),batchId:c.batchId,leaseId:c.leaseId,...fields});
   for(const ch of c.chunks){
    if(phase==='INDEX'){
     await internal('send',{chunkId:ch.id,kind:'EMBEDDING'});await internal('embedded',{chunkId:ch.id,vector:Array(1536).fill(.1),tokens:5});await internal('send',{chunkId:ch.id,kind:'INDEX'});
    }else{await internal('send',{chunkId:ch.id,kind:'LOOKUP_BEFORE'});await internal('send',{chunkId:ch.id,kind:'MERGE'});}
    await internal('send',{chunkId:ch.id,kind:'LOOKUP_AFTER'});await internal('verified',{chunkId:ch.id});
   }
   const finished=await internal('finish',{confirmed:true,elapsedMs:10});
   if(phase==='INDEX')ok(!finished.published);else ok(finished.published===(batch.ordinal===detail.batches.length));
  }
  detail=await view();ok(detail.state===(phase==='INDEX'?'INDEXED_PRIVATE':'ACTIVE'));
 }
 ok((await view()).published);
 const rag=(action,body,actor=id(9001),org='org_default',role=id(9000),operation=false)=>db.query('SELECT eva_composite_rag($1,$2,$3,$4,$5,$6) data',[actor,org,role,operation,action,JSON.stringify(body)]).then(r=>r.rows[0].data);
 const period={from:'2026-10-01',to:'2026-10-31',market:'ACR'};
 const published=await rag('sources',period);ok(published.length===1&&published[0].kind==='COMPOSITE'&&published[0].chunkTotal===101);
 const proofs=published.map(s=>({publicationId:s.publicationId,eventId:s.publicationEventId,kind:'COMPOSITE'}));
 ok((await rag('revalidate',{proofs})).valid);
 const ch=nextPlan.batches[1].chunks[0],hit={releaseId:ready.id,revisionId:nextSource.setId,chunkId:ch.id,contentHash:ch.textHash};
 const rows=await rag('hydrate',{proofs,hits:[hit]});ok(rows.length===1&&rows[0].page===101&&rows[0].text===ch.text);
 await deny(()=>rag('hydrate',{proofs,hits:[{...hit,contentHash:'f'.repeat(64)}]}),'23505');
 await deny(()=>rag('hydrate',{proofs,hits:[hit,hit]}),'22023');
 await deny(()=>rag('revalidate',{proofs:[...proofs,...proofs]}),'22023');
 await deny(()=>rag('sources',period,id(9001),'other'),'42501');
 await deny(()=>rag('sources',period,id(2)),'42501');
 await deny(()=>rag('sources',period,id(1),'org_default',id(9000),true),'42501');
 await rag('begin',{proofs,requestId:id(81000)});
 const metric={requestId:id(81000),eventId:id(81001),state:'READY',elapsedMs:12,inputTokens:8,searchRequests:1,embeddingCostMicroUsd:1};
 ok((await rag('finish',metric)).recorded);await deny(()=>rag('finish',{...metric,eventId:id(81002)}),'23505');
 await db.query("UPDATE organization_members SET status='INACTIVE' WHERE user_id=$1",[id(9001)]);await deny(()=>rag('revalidate',{proofs}),'42501');await db.query("UPDATE organization_members SET status='ACTIVE' WHERE user_id=$1",[id(9001)]);
 detail=await view();await rpc(id(1),'quarantine',ready.id,decision(81003,detail));
 await deny(()=>rag('revalidate',{proofs}),'23505');ok((await rag('sources',period)).length===0);

 const money=await rpc(id(2),'metrics',null,{month:new Date().toISOString().slice(0,7)});ok(money.measuredCostMicroUsd===null&&money.embeddingTokens===510&&money.providerRequests>0);
 await deny(()=>rpc(id(88888),'metrics',null,{month:new Date().toISOString().slice(0,7)}),'42501');
 await deny(()=>db.query('DELETE FROM eva_composite_releases'),'42501');await deny(()=>db.query('UPDATE eva_composite_release_batches SET chunks=\'[]\'::jsonb'),'42501');
 console.log('COMPOSITE_PREPARATION_SQL_PASS');
};
