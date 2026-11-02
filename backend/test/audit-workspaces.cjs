const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');const ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true}}).outputText,f);
(async()=>{const db=new PGlite();const passed=[];try{
const {safeText,auditFilters}=require('../src/modules/audit/audit.model.ts');
assert.ok(!safeText('senha=private https://example.test/?token=abc\nBearer abcd').includes('private'));for(const q of [{size:999},{from:'2020-01-01'},{module:"x' OR true"},{organization:['x']}])assert.throws(()=>auditFilters(q));passed.push('Filtros, limites e sanitização');
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
CREATE TABLE user_profiles(user_id uuid,full_name text);
CREATE TABLE organizations(id text PRIMARY KEY,deleted_at timestamptz);
CREATE TABLE roles(id uuid PRIMARY KEY,organization_id text,name text,scope text,permissions jsonb);
CREATE TABLE organization_members(organization_id text,user_id uuid,role_id uuid,status text,affiliation_type text,permission_limit jsonb);
CREATE TABLE user_roles(user_id uuid,role_id uuid);CREATE TABLE platform_team_members(user_id uuid,active boolean,profile text);
CREATE TABLE licenses(id text,organization_id text,active boolean,status text,start_date date,end_date date,plan_snapshot jsonb);
CREATE TABLE plan_catalog(id uuid);CREATE TABLE permissions(id uuid PRIMARY KEY,code text,name text,module text,resource text,action text);
CREATE TABLE audit_logs(id uuid,organization_id text,user_id uuid,resource_type text,resource_id text,action text,changes jsonb,created_at timestamptz,ip_address text);
CREATE TABLE operation_record_history(id uuid,organization_id text,actor_id text,record_id uuid,reason text,snapshot jsonb,recorded_at timestamptz);
CREATE TABLE platform_plan_audit(id uuid,plan_id uuid,changes jsonb);
CREATE TABLE central_support_cycles(id uuid,organization_id text,starts date,ends date,policy jsonb);
CREATE TABLE central_support_movements(id uuid,cycle_id uuid,extra_minor int,is_extra boolean);
CREATE FUNCTION central_support_summary(uuid) RETURNS jsonb LANGUAGE SQL AS $$SELECT jsonb_build_object('allowance',60,'extraMinor',2500)$$;
CREATE TABLE bot_energy_ai_usage(id uuid,organization_id text,module text,provider text,state text,input_tokens bigint,output_tokens bigint,actual_micro_usd bigint,reserved_micro_usd bigint,created_at timestamptz);
CREATE TABLE ccee_integration_jobs(id uuid,organization_id text,kind text,state text,requests integer,created_at timestamptz);
CREATE FUNCTION assert_license_platform_actor(uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$;
CREATE FUNCTION save_catalog_plan(target_id uuid,expected_version integer,definition jsonb,actor_id uuid,audit_ip text,audit_agent text) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN RETURN jsonb_build_object('id',target_id,'version',expected_version);END$$;
CREATE FUNCTION save_plan_license(target_organization text,target_license text,expected_revision integer,target_plan uuid,expected_version integer,starts date,ends date,renews date,next_status text,selected_modules jsonb,actor_id uuid,audit_ip text,audit_agent text) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN RETURN jsonb_build_object('id',target_license);END$$;`);
await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261218_audit_workspaces.sql'),'utf8'));
await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261219_audit_historical_dates.sql'),'utf8'));
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',g='33333333-3333-4333-8333-333333333333';
for(const [id,org] of [[a,'A'],[b,'B'],[g,null]]){
await db.query('INSERT INTO auth.users(id)VALUES($1)',[id]);
await db.query('INSERT INTO roles VALUES($1,$2,$3,$4,$5)',[id,org,org?'admin_org':'admin_platform',org?'organization':'global',JSON.stringify(org?['dbb580ca-d940-4e80-97fb-e9f9619a0001','dbb580ca-d940-4e80-97fb-e9f9619a0003']:['dbb580ca-d940-4e80-97fb-e9f9619a0004','dbb580ca-d940-4e80-97fb-e9f9619a0005'])]);
if(org){await db.query('INSERT INTO organizations VALUES($1,NULL)',[org]);await db.query("INSERT INTO organization_members VALUES($1,$2,$2,'active','internal',NULL)",[org,id]);await db.query("INSERT INTO licenses(id,organization_id,active,status,start_date,organization_audit)VALUES($1,$2,true,'ACTIVE',current_date-10,true)",[org,org]);}
else{await db.query('INSERT INTO user_roles VALUES($1,$1)',[id]);await db.query("INSERT INTO platform_team_members VALUES($1,true,'OWNER')",[id]);}}
const filters={from:new Date(Date.now()-86400000).toISOString(),to:new Date(Date.now()+86400000).toISOString(),size:25,page:0};
async function read(org,actor,global=false,f=filters){return(await db.query('SELECT energy_audit_read($1,$2,$3,$4) d',[org,actor,global,f])).rows[0].d;}
async function event(org,actor,result='SUCCESS',id=require('node:crypto').randomUUID()){await db.query('SELECT energy_audit_capture($1)',[{id,organization_id:org,actor_id:actor,module:'documents',action:'READ',result,ip:'127.0.0.1',ip_basis:'CONNECTION_ONLY',origin:'origin'}]);return id;}
const id=await event('A',a);await event('B',b);let d=await read('A',a);assert.equal(d.total,1);assert.equal(d.rows[0].ip,null);await assert.rejects(read('B',a));await assert.rejects(read('A',a,false,{...filters,organization:'B'}));await assert.rejects(read(null,a,true));assert.equal((await read(null,g,true)).total,2);passed.push('Isolamento organização/plataforma e IP restrito');
await db.query("UPDATE organization_members SET permission_limit='[]' WHERE user_id=$1",[a]);await assert.rejects(read('A',a));await db.query('UPDATE organization_members SET permission_limit=NULL WHERE user_id=$1',[a]);await db.exec("UPDATE licenses SET organization_audit=false WHERE organization_id='A'");await assert.rejects(read('A',a));await db.exec("UPDATE licenses SET organization_audit=true WHERE organization_id='A'");passed.push('Limite individual e licença');
await event('A',a,'SUCCESS',id);assert.equal((await read('A',a)).total,1);
for(let n=0;n<5;n++)await event(null,null,'AUTH_FAILURE');d=await read(null,g,true);assert.equal(d.alerts.length,1);assert.equal(d.alerts[0].evidence_count,5);assert.equal((await read('A',a)).alerts.length,0);
await db.query('SELECT energy_audit_decide($1,$2,$3,$4,$5,$6)',[null,g,true,d.alerts[0].id,'ANALYSIS','Investigar origem observada']);assert.equal((await read(null,g,true)).decisions.length,1);await assert.rejects(db.exec("UPDATE energy_audit_events SET result='fake'"));await assert.rejects(db.exec('DELETE FROM energy_audit_alert_decisions'));passed.push('Deduplicação, alerta global e histórico imutável');
const presence=stop=>db.query('SELECT energy_audit_presence($1,$2,$3,$4,$5,$6,true)',['A',a,'a'.repeat(64),new Date(Date.now()+3600000).toISOString(),'/backoffice/documents',stop]);await presence(false);await presence(false);assert.equal((await read('A',a)).activeUsers,1);assert.equal((await read('A',a)).modules[0].count,1);await presence(true);assert.equal((await read('A',a)).activeUsers,0);passed.push('Presença, deduplicação de polling e logout');
await db.query("INSERT INTO audit_logs VALUES(gen_random_uuid(),'A',$1,'license','lA','UPDATE','{\"reason\":\"token=secret https://private.example/a\"}',now(),'10.0.0.1')",[a]);d=await read('A',a);assert.ok(d.rows.some(x=>x.source==='audit_logs'));assert.ok(!JSON.stringify(d).includes('token=secret'));assert.equal((await read('A',a,false,{...filters,page:1})).rows.length,0);passed.push('Origem histórica segura e paginação');
const acl=(await db.query("SELECT has_table_privilege('authenticated','energy_audit_events','SELECT') t,has_function_privilege('authenticated','energy_audit_read(text,uuid,boolean,jsonb)','EXECUTE') f")).rows[0];assert.deepEqual(acl,{t:false,f:false});passed.push('RLS e RPC privados');await db.query("INSERT INTO operation_record_history VALUES(gen_random_uuid(),'A',$1,gen_random_uuid(),'Justificativa histórica','{\"status\":\"DONE\",\"token\":\"private\"}',now())",[a]);d=await read('A',a);assert.ok(d.rows.some(x=>x.source==='operation_record_history'&&x.reason==='Justificativa histórica'));assert.ok(!JSON.stringify(d).includes('private'));passed.push('Histórico recorded_at com snapshot permitido');console.log(JSON.stringify({passed},null,2));
}finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
