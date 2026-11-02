const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ts=require('typescript');require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {PGlite}=require('@electric-sql/pglite');
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',g='33333333-3333-4333-8333-333333333333';
(async()=>{const db=new PGlite();const passed=[];try{
const {prepareColdBundle,verifyColdBundle,requireColdDestination}=require('../src/modules/audit/audit-cold-archive.ts');
const plain=JSON.stringify({id:'id1',organization_id:'org_default',created_at:'2018-01-01T00:00:00Z',ip:'restricted'}),item={source:'energy_audit_events',id:'id1',canonicalText:plain,checksum:crypto.createHash('sha256').update(plain).digest('hex')};
const bundle=prepareColdBundle('org_default','V1','2026-11',[item]);assert.deepEqual(verifyColdBundle(bundle.body,bundle.manifest,'org_default'),[item]);assert.ok(!JSON.stringify(bundle.manifest).includes('restricted'));
assert.throws(()=>verifyColdBundle(bundle.body,bundle.manifest,'other'));assert.throws(()=>prepareColdBundle('other','V1','2026-11',[item]));const corrupt=Buffer.from(bundle.body);corrupt[0]^=1;assert.throws(()=>verifyColdBundle(corrupt,bundle.manifest,'org_default'));assert.throws(()=>requireColdDestination());passed.push('Cold bundle local round trip, per-tenant integrity and no unconfigured export');
const fixture=fs.readFileSync(path.join(__dirname,'audit-workspaces.cjs'),'utf8').match(/await db\.exec\(`(CREATE ROLE anon;[\s\S]+?)`\);/)[1];
await db.exec(fixture);await db.exec("SET TIME ZONE 'UTC'");
for(const f of ['20261218_audit_workspaces.sql','20261219_audit_historical_dates.sql','20261220_audit_actor_names.sql','20261221_audit_retention.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations',f),'utf8'));
const manage='dbb580ca-d940-4e80-97fb-e9f9619a0006';
for(const [id,org] of [[a,'org_default'],[b,'B'],[g,null]]){
 await db.query('INSERT INTO auth.users(id)VALUES($1)',[id]);
 await db.query('INSERT INTO roles VALUES($1,$2,$3,$4,$5)',[id,org,org?'admin_org':'admin_platform',org?'organization':'global',JSON.stringify(org?['dbb580ca-d940-4e80-97fb-e9f9619a0001']:['dbb580ca-d940-4e80-97fb-e9f9619a0004'])]);
 if(org){await db.query('INSERT INTO organizations VALUES($1,NULL)',[org]);await db.query("INSERT INTO organization_members VALUES($1,$2,$2,'active','internal',NULL)",[org,id]);await db.query("INSERT INTO licenses(id,organization_id,active,status,start_date,organization_audit)VALUES($1,$2,true,'ACTIVE',current_date-10,true)",[org,org]);}
 else{await db.query('INSERT INTO user_roles VALUES($1,$1)',[id]);await db.query("INSERT INTO platform_team_members VALUES($1,true,'OWNER')",[id]);}
}
async function cl(action,module,role='operacional',result='SUCCESS',source='http'){return(await db.query('SELECT energy_audit_retention_class($1,$2,$3,$4,$5) c',[source,action,module,role,result])).rows[0].c;}
for(const x of [['UPDATE','invoices','operacional','CRITICAL'],['PASSWORD_CHANGE','users','operacional','SECURITY'],['LOGIN','auth','admin_platform','INFO'],['READ','contracts','admin_platform','INFO'],['POST','users','operacional','CRITICAL'],['UPDATE','contracts','operacional','CRITICAL'],['APPROVE','invoices','operacional','CRITICAL'],['DELETE','documents','operacional','CRITICAL'],['PASSWORD_CHANGE','auth','operacional','SECURITY'],['MFA','auth','operacional','SECURITY'],['READ','documents','operacional','INFO'],['PATCH','address','operacional','MEDIUM'],['POST','address','admin_platform','CRITICAL'],['EVENT','unknown','operacional','REVIEW']])assert.equal(await cl(...x.slice(0,3)),x[3]);
assert.equal(await cl('READ','documents','consulta','DENIED'),'SECURITY');assert.equal(await cl('READ','documents','consulta','CRITICAL'),'INFO');passed.push('Critical exceptions, security and ordinary Super Admin browsing are distinct');
assert.equal((await db.query("SELECT energy_audit_retention_expiry('INFO','2024-02-29T06:00:00Z')::text t")).rows[0].t,'2025-02-28 06:00:00+00');
assert.equal((await db.query("SELECT energy_audit_retention_expiry('HIGH','2016-11-02T00:00:00-03:00')::text t")).rows[0].t,'2026-11-02 03:00:00+00');
assert.equal((await db.query("SELECT energy_audit_retention_expiry('CRITICAL',now()) t")).rows[0].t,null);passed.push('Calendar years, leap day and explicit offsets');
async function insert(org,age,action='UPDATE',module='contracts'){
 const id=crypto.randomUUID();await db.query("INSERT INTO energy_audit_events(id,organization_id,actor_id,role,module,action,result,created_at,ip)VALUES($1,$2,$3,'operacional',$4,$5,'SUCCESS',now()-$6::interval,'127.0.0.1')",[id,org,a,module,action,age]);return id;
}
const old=await insert('org_default','30 months'),other=await insert('B','30 months'),expired=await insert('org_default','13 months','READ','documents'),cold=await insert('org_default','6 years'),unknown=await insert('org_default','3 years','EVENT','unknown');
const act=(action,data,actor=g)=>db.query('SELECT energy_audit_retention_act($1,$2,$3) d',[actor,action,data]).then(r=>r.rows[0].d);
const stat=(org,actor,global=false)=>db.query('SELECT energy_audit_retention_read($1,$2,$3) d',[org,actor,global]).then(r=>r.rows[0].d);
await assert.rejects(act('APPROVE_MOVE',{organization:'org_default',ids:[old],reason:'Conferência de lote exato'})); // No implicit management grant.
await db.query("UPDATE roles SET permissions=permissions||$1::jsonb WHERE id=$2",[JSON.stringify([manage]),g]);
await assert.rejects(act('APPROVE_MOVE',{organization:'org_default',ids:[other],reason:'Tentativa de escopo incorreto'}));
await assert.rejects(act('APPROVE_MOVE',{organization:'org_default',ids:[expired],reason:'Vencido não pode ser arquivado'}));
await assert.rejects(act('APPROVE_MOVE',{organization:'org_default',ids:[unknown],reason:'Origem não classificada'}));
await assert.rejects(act('APPROVE_MOVE',{organization:'org_default',ids:[old,old],reason:'Não duplicar a identidade'}));
await assert.rejects(stat('B',a));assert.equal((await stat('B',b)).archive.records,0);passed.push('Owner needs a separately granted permission; batch identity and tenant boundaries');
const held=await act('HOLD',{organization:'org_default',source:'energy_audit_events',sourceId:old,reason:'Preservar para investigação em curso',basis:'Obrigação e necessidade documentadas',reviewAt:'2090-01-01T00:00:00-03:00'});
await assert.rejects(act('APPROVE_MOVE',{organization:'org_default',ids:[old],reason:'Bloqueio precisa ser preservado'}));
await act('RELEASE_HOLD',{id:held.id,reason:'Concluída investigação e revisado impedimento'});
const approval=await act('APPROVE_MOVE',{organization:'org_default',ids:[old,cold],reason:'Lote sintético exato conferido e recuperável'});
// A hold created after approval must stop the entire atomic transfer.
const hold2=await act('HOLD',{organization:'org_default',reason:'Preservar organização durante investigação',basis:'Escopo de investigação documentado',reviewAt:'2090-01-01T00:00:00Z'});
await assert.rejects(act('EXECUTE_MOVE',{id:approval.id,reason:'Executar lote conferido'}));
assert.equal((await db.query('SELECT count(*)::int n FROM audit_logs_archive')).rows[0].n,0);
await act('RELEASE_HOLD',{id:hold2.id,reason:'Impedimento revisado e investigação concluída'});
// Plain DELETE and session variables can never authorize the transfer.
await assert.rejects(db.query('DELETE FROM energy_audit_events WHERE id=$1',[old]));
await db.exec("SET app.audit_transfer='true'");await assert.rejects(db.query('DELETE FROM energy_audit_events WHERE id=$1',[old]));
await act('EXECUTE_MOVE',{id:approval.id,reason:'Executar lote conferido'});
assert.equal((await act('EXECUTE_MOVE',{id:approval.id,reason:'Consultar resultado sem duplicar'})).idempotent,true);
assert.equal((await stat('org_default',a)).archive.records,2);
assert.equal((await stat('B',b)).archive.records,0);
await assert.rejects(db.exec("UPDATE audit_logs_archive SET canonical='{}'"));
await assert.rejects(db.exec('DELETE FROM audit_retention_decisions'));passed.push('Hold race, no flag bypass, atomic canonical transfer, retry and immutable archive');
const f={from:new Date(Date.now()-36*31*86400000).toISOString(),to:new Date(Date.now()-25*30*86400000).toISOString(),size:25,page:0,storage:'HISTORY'};
const read=async(org,actor,filters)=> (await db.query('SELECT energy_audit_read($1,$2,false,$3) d',[org,actor,filters])).rows[0].d;
const hist=await read('org_default',a,f);assert.equal(hist.total,1);assert.equal(hist.rows[0].id,old);assert.equal(hist.rows[0].ip,null);assert.equal(hist.rows[0].details.storage,'HISTORY');assert.equal((await read('B',b,f)).total,0);
await db.query("UPDATE organization_members SET status='inactive' WHERE user_id=$1",[a]);await assert.rejects(read('org_default',a,f));await db.query("UPDATE organization_members SET status='active' WHERE user_id=$1",[a]);passed.push('Archived search, IP redaction and current membership revocation');
const obj=(await stat('org_default',a)).objects[0];assert.equal(obj.state,'WAITING_STORAGE');await assert.rejects(act('REQUEST_RESTORE',{id:obj.id,reason:'Restaurar objeto sem permissão própria'}));
// A previous incomplete cycle must finish before the current month starts.
await db.exec("INSERT INTO audit_retention_jobs(policy_version,organization_id,cycle,kind,state) VALUES('V1','org_default',date_trunc('month',now())-interval '1 month' + interval '6 hours','SIMULATION','RUNNING')");
const pending=(await db.query("SELECT energy_audit_retention_tick(1) d")).rows[0].d;
assert.equal((await db.query("SELECT cycle<date_trunc('month',now()) older FROM audit_retention_jobs WHERE id=$1",[pending.id])).rows[0].older,true);
let tick;for(let i=0;i<20;i++){tick=(await db.query('SELECT energy_audit_retention_tick(2) d')).rows[0].d;if(tick.state==='COMPLETED')break;}assert.equal(tick.state,'COMPLETED');
for(let i=0;i<20;i++){tick=(await db.query('SELECT energy_audit_retention_tick(2) d')).rows[0].d;if(tick.state==='COMPLETED')break;}
const job=(await stat('org_default',a)).jobs.find(j=>j.kind==='SIMULATION');assert.ok(job.scanned>=4);assert.ok(job.counts['INFO:EXPIRED_PENDING_DECISION']>=1);assert.ok(job.counts['REVIEW:REVIEW']>=1);assert.equal((await db.query('SELECT count(*)::int n FROM energy_audit_events WHERE id=$1',[expired])).rows[0].n,1);
assert.equal((await db.query('SELECT energy_audit_retention_tick(2) d')).rows[0].d.id,job.id);passed.push('Monthly resumable simulation, expired queue, no disposal and no cold upload');
for(const t of ['audit_logs_archive','audit_retention_jobs','audit_legal_holds'])assert.equal((await db.query("SELECT has_table_privilege('service_role',$1,'DELETE') p",[t])).rows[0].p,false);
assert.equal((await db.query("SELECT has_function_privilege('authenticated','energy_audit_retention_act(uuid,text,jsonb)','EXECUTE') p")).rows[0].p,false);
passed.push('No direct DML or browser RPC access');console.log(JSON.stringify({passed},null,2));
}finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
