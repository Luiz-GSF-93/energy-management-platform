// Reuses the disposable preparation fixture, including the real Owner function.
module.exports=async({db,id,ok,deny,call,body,orderJob,orderVersion,orderReview,orderChunks,manifest,checks})=>{
 const fs=require('node:fs'),path=require('node:path');
 await db.exec(fs.readFileSync(path.resolve(__dirname,'../src/database/migrations/20261030_eva_search_execution.sql'),'utf8'));
 await db.query('UPDATE platform_team_members SET active=true WHERE user_id=$1',[id(1)]);
 const exec=(a,op,c,b)=>db.query('SELECT eva_search_execution_action($1,$2,$3,$4) data',[a,op,c,JSON.stringify(b)]).then(x=>x.rows[0].data);
 const release=async(n)=>{const input={...body,requestId:id(n),jobId:orderJob,expectedVersionId:orderVersion,expectedReviewEventId:orderReview,manifest:{...manifest,jobId:orderJob,versionId:orderVersion,reviewEventId:orderReview},chunks:orderChunks};await call(id(1),'prepare',null,input);const d=await call(id(1),'detail',id(n),{page:0});await call(id(2),'approve',id(n),{requestId:id(n+1),expectedEventId:d.eventId,justification:'Independent Owner verifies this disposable test release.'});return id(n+1)};
 const prepare=(n,rel,ev)=>({requestId:id(n),releaseId:id(rel),expectedReleaseEventId:ev,tokenLimit:10000,justification:'Prepare a bounded disposable private Search execution.'});
 const decision=(n,event)=>({requestId:id(n),expectedEventId:event,justification:'Owner verifies the bounded execution without publication.'});
 for(const t of ['eva_search_execution_commands','eva_search_execution_events','eva_search_execution_receipts']){
  const flags=(await db.query('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass',[t])).rows[0];ok(flags.relrowsecurity&&flags.relforcerowsecurity);
  for(const role of ['anon','authenticated','service_role'])for(const permission of ['SELECT','INSERT','UPDATE','DELETE'])ok(!(await db.query('SELECT has_table_privilege($1,$2,$3) p',[role,t,permission])).rows[0].p);
 }
 for(const role of ['anon','authenticated'])ok(!(await db.query("SELECT has_function_privilege($1,'eva_search_execution_action(uuid,text,uuid,jsonb)','EXECUTE') p",[role])).rows[0].p);
 for(const role of ['anon','authenticated','service_role'])ok(!(await db.query("SELECT has_function_privilege($1,'eva_search_execution_live(uuid)','EXECUTE') p",[role])).rows[0].p);
 const ev=await release(700),p=prepare(710,700,ev);
 for(const actor of [null,id(3),id(4),id(99)])await deny(()=>exec(actor,'prepare',id(710),p),'42501');
 for(const patch of [{tokenLimit:0},{organizationId:'org_other'},{expectedReleaseEventId:id(999)},{tokenLimit:1}])await deny(()=>exec(id(1),'prepare',id(710),{...p,...patch}),patch.expectedReleaseEventId||patch.tokenLimit===1?'23505':'22023');
 ok((await exec(id(1),'prepare',id(710),p)).state==='PREPARED');ok((await exec(id(1),'prepare',id(710),p)).replayed);
 await deny(()=>exec(id(2),'prepare',id(710),p),'23505');await deny(()=>exec(id(1),'prepare',id(712),{...p,requestId:id(712)}),'23505');
 const racing=await Promise.allSettled([exec(id(1),'claim',id(710),decision(711,id(710))),exec(id(2),'claim',id(710),decision(719,id(710)))]);ok(racing.filter(x=>x.status==='fulfilled').length===1&&racing.filter(x=>x.status==='rejected'&&x.reason.code==='23505').length===1);
 const lease=racing.find(x=>x.status==='fulfilled').value;ok(lease.leaseId===id(711)&&lease.chunks.length===12&&lease.chunks[0].text==='Document table part 0');
 await deny(()=>exec(id(2),'claim',id(710),decision(713,id(711))),'23505');await deny(()=>exec(id(1),'withdraw',id(710),decision(714,id(711))),'23505');
 const finish=(n,state,reason)=>({leaseId:id(711),requestId:id(n),state,reason,elapsedMs:17});
 await deny(()=>exec(id(1),'finish',id(710),finish(715,'SUCCEEDED','CONFIRMED')),'23505');
 const vector=Array(1536).fill(.125);
 for(let i=0;i<lease.chunks.length;i++){
  const chunk=lease.chunks[i],base=1000+i*5;
  const send={leaseId:id(711),requestId:id(base),kind:'EMBEDDING',chunkId:chunk.id,reservedTokens:Buffer.byteLength(chunk.text)};
  await deny(()=>exec(id(1),'send',id(710),{...send,leaseId:id(999)}),'23505');
  ok((await exec(id(1),'send',id(710),send)).reserved);
  await deny(()=>exec(id(1),'send',id(710),{...send,requestId:id(base+1)}),'23505');
  await deny(()=>exec(id(1),'embedded',id(710),{leaseId:id(711),chunkId:chunk.id,vector:[0],tokens:1}),'22023');
  ok((await exec(id(1),'embedded',id(710),{leaseId:id(711),chunkId:chunk.id,vector,tokens:1})).preserved);
  await deny(()=>exec(id(1),'embedded',id(710),{leaseId:id(711),chunkId:chunk.id,vector,tokens:1}),'23505');
  for(const [kind,offset]of [['INDEX',2],['LOOKUP',3]])ok((await exec(id(1),'send',id(710),{...send,requestId:id(base+offset),kind,reservedTokens:0})).reserved);
  ok((await exec(id(1),'verified',id(710),{leaseId:id(711),requestId:id(base+4),chunkId:chunk.id})).verified);
 }
 ok((await exec(id(1),'finish',id(710),finish(716,'SUCCEEDED','CONFIRMED'))).state==='SUCCEEDED');
 const d=await exec(id(1),'detail',id(710),{page:0});ok(d.receiptCount===12&&d.published===false&&!('vector'in d)&&d.history.length===10);
 const h2=await exec(id(1),'detail',id(710),{page:1});ok(h2.history.length===10&&new Set([...d.history,...h2.history].map(x=>x.id)).size===20);
 await deny(()=>exec(id(3),'detail',id(710),{page:0}),'42501');
 const ev2=await release(720);await exec(id(1),'prepare',id(730),prepare(730,720,ev2));const lease2=await exec(id(1),'claim',id(730),decision(731,id(730)));
 await exec(id(1),'finish',id(730),{leaseId:lease2.leaseId,requestId:id(732),state:'UNKNOWN',reason:'PROVIDER_UNKNOWN',elapsedMs:10});
 const recovered=await exec(id(1),'reconcile',id(730),decision(733,id(732)));ok(recovered.chunks.every(x=>x.vector===null));
 await deny(()=>exec(id(1),'send',id(730),{leaseId:id(733),requestId:id(734),kind:'INDEX',chunkId:recovered.chunks[0].id,reservedTokens:0}),'42501');
 ok((await exec(id(1),'send',id(730),{leaseId:id(733),requestId:id(735),kind:'LOOKUP',chunkId:recovered.chunks[0].id,reservedTokens:0})).reserved);
 await deny(()=>exec(id(1),'finish',id(730),{leaseId:id(733),requestId:id(736),state:'SUCCEEDED',reason:'CONFIRMED',elapsedMs:1}),'23505');
 await exec(id(1),'finish',id(730),{leaseId:id(733),requestId:id(737),state:'UNKNOWN',reason:'MISSING_OR_DIVERGENT',elapsedMs:1});
 const ev3=await release(740);await exec(id(1),'prepare',id(750),prepare(750,740,ev3));await exec(id(1),'withdraw',id(750),decision(751,id(750)));await deny(()=>exec(id(1),'claim',id(750),decision(752,id(751))),'23505');
 const ev4=await release(760);await exec(id(1),'prepare',id(770),prepare(770,760,ev4));await exec(id(1),'claim',id(770),decision(771,id(770)));
 await deny(()=>exec(id(1),'reconcile',id(770),decision(772,id(771))),'23505');
 await db.query("UPDATE eva_search_execution_commands SET lease_until=clock_timestamp()-interval '1 minute' WHERE id=$1",[id(770)]);
 ok((await exec(id(1),'reconcile',id(770),decision(773,id(771)))).leaseId===id(773));
 await db.query("INSERT INTO eva_official_curation_events VALUES($1,$2,$3,'QUARANTINED',2)",[id(774),orderJob,orderVersion]);
 await deny(()=>exec(id(1),'send',id(770),{leaseId:id(773),requestId:id(775),kind:'LOOKUP',chunkId:orderChunks[0].id,reservedTokens:0}),'23505');
 await exec(id(1),'finish',id(770),{leaseId:id(773),requestId:id(776),state:'UNKNOWN',reason:'SOURCE_CHANGED',elapsedMs:1});
 const month=new Date().toISOString().slice(0,7);
 for(const actor of [id(1),id(3)]){const m=await exec(actor,'metrics',null,{month});ok(m.commands===4&&m.inputTokens===12&&m.actualCostMicroUsd===null&&!('chunks'in m)&&!('history'in m));}
 await deny(()=>exec(id(4),'metrics',null,{month}),'42501');await deny(()=>exec(id(3),'metrics',null,{month:'2026-99'}),'22023');
 await db.query('UPDATE platform_team_members SET active=false WHERE user_id=$1',[id(1)]);await deny(()=>exec(id(1),'list',null,{page:0,state:''}),'42501');
 for(const t of ['eva_search_execution_events','eva_search_execution_receipts'])await deny(()=>db.query('DELETE FROM '+t),'42501');
 ok((await db.query('SELECT count(*) n FROM eva_search_jobs WHERE external_requests<>0 OR actual_tokens IS NOT NULL')).rows[0].n===0);
};
