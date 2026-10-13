// Disposable PostgreSQL only; no application environment or production connection.
const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
let checks=0;const ok=v=>{assert.ok(v);checks++},id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
(async()=>{const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE roles(id uuid,scope text,name text,organization_id text,permissions jsonb);
 CREATE TABLE user_roles(user_id uuid,role_id uuid);CREATE TABLE platform_team_members(user_id uuid,profile text,active boolean);CREATE TABLE user_profiles(user_id uuid);
 INSERT INTO roles VALUES('${id(11)}','global','admin_platform','${id(9)}','["82e7fc71-479a-4dd6-8b22-4fba6eaa6841"]'),('${id(12)}','global','platform_finance','${id(9)}','[]');
 INSERT INTO user_roles VALUES('${id(1)}','${id(11)}'),('${id(2)}','${id(12)}');INSERT INTO platform_team_members VALUES('${id(1)}','OWNER',true),('${id(2)}','FINANCE',true);INSERT INTO user_profiles VALUES('${id(1)}'),('${id(2)}');`);
 const team=fs.readFileSync(path.resolve(__dirname,'../src/database/migrations/20261010_platform_team.sql'),'utf8');
 const helper=team.slice(team.indexOf('CREATE OR REPLACE FUNCTION public.platform_team_owner('),team.indexOf('END $$;',team.indexOf('CREATE OR REPLACE FUNCTION public.platform_team_owner('))+7);await db.exec(helper);
 const migration=fs.readFileSync(path.resolve(__dirname,'../src/database/migrations/20261022_eva_product_guide_publications.sql'),'utf8');await db.exec(migration);
 const call=(actor,action,body)=>db.query('SELECT eva_product_guide_admin_action($1,$2,$3) AS data',[actor,action,JSON.stringify(body)]).then(r=>r.rows[0].data);
 const deny=async(fn,code)=>{let err;try{await fn()}catch(e){err=e}ok(err?.code===code)};
 for(const table of ['eva_product_guide_publications','eva_product_guide_publication_events']){
  const r=(await db.query('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass',[table])).rows[0];ok(r.relrowsecurity&&r.relforcerowsecurity);
  for(const role of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])ok(!(await db.query('SELECT has_table_privilege($1,$2,$3) AS p',[role,table,privilege])).rows[0].p);
 }
 for(const fn of ['eva_product_guide_admin_action(uuid,text,jsonb)','eva_product_guide_read_publication(text,text,text)']){for(const role of ['anon','authenticated'])ok(!(await db.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS p',[role,fn])).rows[0].p);ok((await db.query('SELECT has_function_privilege(\'service_role\',$1,\'EXECUTE\') AS p',[fn])).rows[0].p)}
 await deny(()=>call(null,'list',{}),'42501');await deny(()=>call(id(2),'list',{}),'42501');
 for(const profile of ['ADMINISTRATOR','FINANCE','SUPPORT']){await db.query('UPDATE platform_team_members SET profile=$1 WHERE user_id=$2',[profile,id(1)]);await deny(()=>call(id(1),'list',{}),'42501')}
 await db.query('UPDATE platform_team_members SET profile=\'OWNER\' WHERE user_id=$1',[id(1)]);
 const hash='a'.repeat(64),body={requestId:id(20),expectedEventId:null,expectedDocumentHash:hash,justification:'Synthetic Owner review of the guide version.',key:'guide-client-units',version:'1',release:'energyos-product-guides-v1',documentHash:hash,contentHash:'b'.repeat(64),snapshot:{key:'guide-client-units',content:{title:'Synthetic'},roles:['admin_org'],permissions:[],modules:[],codeSnapshots:[]}};
 ok((await call(id(1),'list',{})).length===0);ok((await call(id(1),'publish',body)).state==='PUBLISHED');ok((await call(id(1),'publish',body)).replayed===true);
 await deny(()=>call(id(1),'publish',{...body,justification:'A different justification conflicts with prior input.'}),'23505');
 const read=()=>db.query('SELECT eva_product_guide_read_publication($1,$2,$3) AS data',[body.key,body.version,hash]).then(r=>r.rows[0].data);
 ok((await read()).actor_id===id(1));ok((await call(id(1),'detail',{key:body.key,version:'1',page:0})).historyTotal===1);
 await deny(()=>db.query('UPDATE eva_product_guide_publications SET release=\'forged\''),'42501');await deny(()=>db.query('DELETE FROM eva_product_guide_publication_events'),'42501');
 await deny(()=>call(id(1),'publish',{...body,requestId:id(21)}),'23505');
 await deny(()=>call(id(1),'quarantine',{...body,requestId:id(22),snapshot:undefined}),'23505');
 const q={...body,requestId:id(23),expectedEventId:id(20)};delete q.snapshot;
 await deny(()=>call(id(1),'quarantine',{...q,actorId:id(2)}),'22023');
 const competing=await Promise.allSettled([call(id(1),'quarantine',q),call(id(1),'quarantine',{...q,requestId:id(24)})]);ok(competing.filter(v=>v.status==='fulfilled').length===1);ok(competing.filter(v=>v.status==='rejected'&&v.reason.code==='23505').length===1);
 ok(await read()===null);ok((await call(id(1),'publish',body)).state==='QUARANTINED');ok((await call(id(1),'detail',{key:body.key,version:'1',page:0})).historyTotal===2);
 await deny(()=>call(id(1),'publish',{...body,requestId:id(25),expectedEventId:id(23)}),'23505');
 await db.query('UPDATE platform_team_members SET active=false WHERE user_id=$1',[id(1)]);await deny(()=>call(id(1),'list',{}),'42501');await db.query('UPDATE platform_team_members SET active=true WHERE user_id=$1',[id(1)]);
 for(const patch of [{key:'unknown'},{justification:'short'},{expectedDocumentHash:'c'.repeat(64)},{requestId:12},{actorId:id(2)}])await deny(()=>call(id(1),'publish',{...body,...patch,requestId:typeof patch.requestId==='number'?12:id(30)}),'22023');
 console.log(JSON.stringify({checks,result:'PASS',tables:2,productionCalls:0}));
 }finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
