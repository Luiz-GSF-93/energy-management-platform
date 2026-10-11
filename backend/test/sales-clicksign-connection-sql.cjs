const {PGlite}=require('@electric-sql/pglite'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();let checks=0;const id=n=>'11111111-1111-4111-8111-'+String(n).padStart(12,'0'),owner=id(1),other=id(2);
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE user_roles(user_id text,role_id text);CREATE TABLE roles(id text,scope text,name text,organization_id text,permissions jsonb);
 CREATE TABLE platform_team_members(user_id uuid,active boolean,profile text);CREATE TABLE user_profiles(user_id uuid,full_name text);
 CREATE FUNCTION platform_sales_commercial_immutable() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'immutable' USING ERRCODE='42501';END$$;`);
 const team=fs.readFileSync('src/database/migrations/20261010_platform_team.sql','utf8');await db.exec(team.slice(team.indexOf('CREATE OR REPLACE FUNCTION public.platform_team_owner('),team.indexOf('CREATE OR REPLACE FUNCTION public.platform_team_lock(')));
 await db.exec(fs.readFileSync('src/database/migrations/20261010_platform_sales_finance_read.sql','utf8').match(/CREATE OR REPLACE FUNCTION public.platform_sales_finance_name[\s\S]*?END \$\$;/)[0]);
 await db.query('insert into roles values($1,$2,$3,$4,$5)',['owner','global','admin_platform','platform',JSON.stringify(['82e7fc71-479a-4dd6-8b22-4fba6eaa6841'])]);
 for(const actor of [owner,other]){await db.query('insert into user_roles values($1,$2)',[actor,'owner']);await db.query('insert into platform_team_members values($1,true,$2)',[actor,'OWNER']);}
 await db.query('insert into user_profiles values($1,$2)',[owner,'Original Owner']);
 await db.query('insert into user_profiles values($1,$2)',[other,'Other Owner']);
 const migration=fs.readFileSync('src/database/migrations/20261017_platform_sales_clicksign_connection.sql','utf8');
 await db.exec('BEGIN;'+migration.replace(/^BEGIN;/,'').replace(/COMMIT;\s*$/,'')+'ROLLBACK;');
 assert.equal((await db.query("select to_regclass('platform_sales_clicksign_connections') x")).rows[0].x,null);checks++;
 await db.exec(migration);
 const call=async(action,b,actor=owner)=>(await db.query('select platform_sales_clicksign_connection_action($1,$2,$3) v',[actor,action,JSON.stringify(b)])).rows[0].v;
 const reject=async(f,code)=>{await assert.rejects(f,e=>e.code===code);checks++;};
 const prep=n=>({requestId:id(n),accountId:'1116892',justification:'Controlled production connection fixture.'});
 const finish=(n,state='AUTHENTICATED',diagnostic='OK',httpStatus=200)=>({requestId:id(n),state,diagnostic,httpStatus});
 for(const profile of ['SUPPORT','FINANCE','ADMIN']){await db.query('update platform_team_members set profile=$1 where user_id=$2',[profile,other]);for(const action of ['list','begin','complete'])await reject(()=>call(action,{},other),'42501');}
 await db.query("update platform_team_members set profile='OWNER' where user_id=$1",[other]);
 for(const action of ['list','begin','complete'])await reject(()=>call(action,{},null),'42501');
 await db.query('update platform_team_members set active=false where user_id=$1',[owner]);await reject(()=>call('list',{accountId:'1116892',page:0}),'42501');await db.query('update platform_team_members set active=true where user_id=$1',[owner]);
 for(const body of [{accountId:'1',page:-1},{accountId:'01',page:0},{accountId:'1',page:1001},{accountId:'1',page:0,url:'https://example.com'},{accountId:'1',page:null}])await reject(()=>call('list',body),'22023');
 for(const body of [{...prep(10),token:'secret'},{...prep(10),accountId:'0'},{...prep(10),justification:'short'},{...prep(10),justification:'control character\nwith enough length'}])await reject(()=>call('begin',body),'22023');
 assert.equal((await call('begin',prep(10))).replayed,false);checks++;
 assert.equal((await call('begin',prep(10))).state,'PENDING');checks++;
 await reject(()=>call('begin',{...prep(10),justification:'Changed original justification fixture.'}),'23505');
 await reject(()=>call('begin',prep(10),other),'23505');
 await reject(()=>call('begin',prep(11)),'23505');
 await reject(()=>call('begin',{...prep(11),accountId:'24015'}),'23505');
 await reject(()=>call('complete',finish(10),other),'23505');
 for(const b of [finish(10,'AUTHENTICATED','OK',null),finish(10,'REJECTED','HTTP',null),finish(10,'AUTHENTICATED','OK',201),finish(10,'INCOMPLETE','OK',null)])await reject(()=>call('complete',b),'23514');
 for(const b of [{...finish(10),payload:{token:'secret'}},finish(10,'SIGNED'),finish(10,'INCOMPLETE','UNKNOWN')])await reject(()=>call('complete',b),'22023');
 assert.equal((await call('complete',finish(10))).realActivationEligible,false);checks++;
 assert.equal((await call('complete',finish(10))).replayed,true);checks++;
 await reject(()=>call('complete',finish(10,'REJECTED','HTTP',401)),'23505');
 assert.equal((await call('begin',prep(10))).state,'AUTHENTICATED');checks++;
 await db.query("update user_profiles set full_name='Renamed Owner'");
 let list=await call('list',{accountId:'1116892',page:0});
 assert.equal(list.rows[0].actor_name,'Original Owner');assert.equal(list.rows[0].currentActorName,'Renamed Owner');assert.equal(list.rows[0].result.actor_name,'Original Owner');assert.equal(list.rows[0].result.currentActorName,'Renamed Owner');assert.equal(list.rows[0].input,undefined);assert.equal(list.accountIdentityVerified,false);checks+=6;
 await db.query('update user_profiles set full_name=null');list=await call('list',{accountId:'1116892',page:0});assert.equal(list.rows[0].currentActorName,null);assert.equal(list.rows[0].actor_name,'Original Owner');checks+=2;
 assert.equal((await call('list',{accountId:'24015',page:0})).total,0);checks++;
 for(let n=11;n<=36;n++){await call('begin',prep(n));await call('complete',finish(n,'INCOMPLETE','NETWORK',null));}
 list=await call('list',{accountId:'1116892',page:0});assert.equal(list.total,27);assert.equal(list.rows.length,25);assert.equal((await call('list',{accountId:'1116892',page:1})).rows.length,2);checks+=3;
 await call('begin',{...prep(37),accountId:'24015'});await call('complete',finish(37,'REJECTED','HTTP',403));assert.equal((await call('list',{accountId:'24015',page:0})).total,1);checks++;
 const competing=await Promise.allSettled([call('begin',prep(38)),call('begin',prep(39))]);assert.equal(competing.filter(v=>v.status==='fulfilled').length,1);assert.equal(competing.filter(v=>v.status==='rejected'&&v.reason.code==='23505').length,1);checks+=2;
 const winner=competing[0].status==='fulfilled'?38:39;await call('complete',finish(winner,'INCOMPLETE','TIMEOUT',null));
 await db.query('delete from user_profiles where user_id=$1',[owner]);await reject(()=>call('list',{accountId:'1116892',page:0}),'42501');list=await call('list',{accountId:'1116892',page:0},other);assert.equal(list.rows.find(r=>r.request_id===id(10)),undefined);assert.equal(list.rows[0].currentActorName,null);checks+=2;await db.query('insert into user_profiles values($1,$2)',[owner,null]);
 for(const table of ['platform_sales_clicksign_connections','platform_sales_clicksign_connection_results']){
  await reject(()=>db.exec('update '+table+' set actor_name=\'spoof\''),'42501');await reject(()=>db.exec('delete from '+table),'42501');
  assert.equal((await db.query('select relrowsecurity from pg_class where oid=$1::regclass',[table])).rows[0].relrowsecurity,true);checks++;
  for(const role of ['anon','authenticated','service_role']){assert.equal((await db.query('select has_table_privilege($1,$2,$3) v',[role,table,'SELECT,INSERT,UPDATE,DELETE'])).rows[0].v,false);checks++;}
 }
 for(const role of ['anon','authenticated']){assert.equal((await db.query("select has_function_privilege($1,'platform_sales_clicksign_connection_action(uuid,text,jsonb)','EXECUTE') v",[role])).rows[0].v,false);checks++;}
 await db.exec('SET ROLE service_role');assert.equal((await call('list',{accountId:'24015',page:0})).total,1);checks++;await reject(()=>db.exec('select * from platform_sales_clicksign_connections'),'42501');await db.exec('RESET ROLE');
 const fn=(await db.query("select prosecdef,proconfig from pg_proc where proname='platform_sales_clicksign_connection_action'")).rows[0];assert.equal(fn.prosecdef,true);assert.ok(fn.proconfig.includes('search_path=pg_catalog'));checks+=2;
 await db.close();console.log(`Clicksign production connection SQL: ${checks} checks passed`);
})().catch(e=>{console.error(e);process.exit(1);});
