// Disposable named local PostgreSQL only, with no database URL or application credentials.
// postgres:17, user/database energyos_fixture, local port 55438; pg@8.16.3 via temporary NODE_PATH.
const fs=require('node:fs'),pg=require('pg');pg.types.setTypeParser(20,Number);
const config={host:'127.0.0.1',port:55438,user:'energyos_fixture',database:'energyos_fixture',password:'disposable_fixture',application_name:'energyos_lifecycle_disposable'};
class PgFixture{constructor(){this.client=new pg.Client(config);this.ready=this.client.connect();}async exec(sql){await this.ready;return this.client.query(sql);}async query(sql,v){await this.ready;return this.client.query(sql,v);}async close(){return this.client.end();}}
const head="const {PGlite}=require('@electric-sql/pglite'),fs=require('fs'),assert=require('node:assert/strict');";
const req=name=>{
 if(name==='pg-fixture')return {PGlite:PgFixture,pg,config};
 if(name==='node:fs')return {...fs,readFileSync:(path,...args)=>{const text=fs.readFileSync(path,...args);if(path!=='test/sales-signature-recovery-sql.cjs')return text;if(!text.includes(head))throw Error('Fixture changed');return text.replace(head,"const {PGlite}=require('pg-fixture'),fs=require('fs'),assert=require('node:assert/strict');");}};
 return require(name);
};
const source=fs.readFileSync('test/sales-signature-lifecycle-sql.cjs','utf8'),marker=" console.log('PASS',checks,'signature lifecycle SQL checks; no external services or shared database');await db.close();";
if(!source.includes(marker))throw Error('Concurrency insertion point changed');
const cases=String.raw`
 // Finish the second fixture's configured resources. No network or provider creation.
 for(let ordinal=3;ordinal<=8;ordinal++){const lease=id(700+ordinal);await dispatch('claim',{id:request2,lease,expectedOrdinal:ordinal,justification:'Second private concurrency fixture resources.'});await dispatch('reserve',{id:request2,lease});await dispatch('finish',{id:request2,lease,result:{externalId:id(710+ordinal),type:ordinal<5?'signers':'requirements'}});}
 const pre={id:request2,requestId:id(750),eventHash:null,justification:'Private PostgreSQL simultaneous command fixture.'};const cp=await life('check_begin',pre);
 const pp={envelopeId:cp.resources[0].external_id,documentId:cp.resources[1].external_id,status:'DRAFT',signedAt:null,signers:cp.resources.slice(2,4).map(x=>x.external_id),log:[],environment:'SANDBOX',realActivationEligible:false};await life('check_finish',{id:request2,requestId:pre.requestId,result:{proof:pp,pdfHex:null}});
 const {pg,config}=require('pg-fixture'),c1=new pg.Client(config),c2=new pg.Client(config);await c1.connect();await c2.connect();
 const invoke=(client,action,body)=>client.query('select platform_sales_signature_lifecycle_action($1,$2,$3) v',[owner,action,JSON.stringify(body)]);
 async function waitBlocked(){for(let i=0;i<100;i++){if((await db.query("select count(*) n from pg_stat_activity where application_name='energyos_lifecycle_disposable' and wait_event='advisory'")).rows[0].n>0)return;await new Promise(r=>setTimeout(r,10));}throw Error('Expected advisory lock wait');}
 try{
  const b1={id:request2,requestId:id(751),checkId:pre.requestId,kind:'ACTIVATE',justification:'Exactly one reserved activation in PostgreSQL.'},b2={...b1,requestId:id(752)};
  await c1.query('BEGIN');await invoke(c1,'command_reserve',b1);const blocked=invoke(c2,'command_reserve',b2).then(()=>({ok:true}),e=>({code:e.code}));await waitBlocked();checks++;await c1.query('COMMIT');assert.equal((await blocked).code,'23505');checks++;
  assert.equal((await db.query('select count(*) n from platform_sales_signature_lifecycle_commands where signature_id=$1',[request2])).rows[0].n,1);checks++;
  const done={id:request2,requestId:b1.requestId,state:'UNKNOWN'};await c1.query('BEGIN');await invoke(c1,'command_finish',done);const replay=invoke(c2,'command_finish',done);await waitBlocked();checks++;await c1.query('COMMIT');assert.equal((await replay).rows[0].v.replayed,true);checks++;
  assert.equal((await db.query('select count(*) n from platform_sales_signature_lifecycle_events where command_id=$1 and state=$2',[b1.requestId,'UNKNOWN'])).rows[0].n,1);checks++;
  // Webhook re-delivery concurrent with the same canonical event is appended exactly once.
  const e={account:id(600),documentId:cp.resources[1].external_id,name:'update_document',occurredAt:new Date().toISOString(),signerId:null,eventHash:'1'.repeat(64),rawHash:'2'.repeat(64)};
  await c1.query('BEGIN');await c1.query('select platform_sales_signature_receive_event($1)',[JSON.stringify(e)]);const redelivery=c2.query('select platform_sales_signature_receive_event($1) v',[JSON.stringify(e)]);await waitBlocked();checks++;await c1.query('COMMIT');assert.equal((await redelivery).rows[0].v.replayed,true);checks++;
  assert.equal((await db.query('select count(*) n from platform_sales_signature_inbox where event_hash=$1',[e.eventHash])).rows[0].n,1);checks++;
 }finally{await c1.query('ROLLBACK');await c1.end();await c2.end();}
 console.log('PASS',checks,'PostgreSQL lifecycle checks including simultaneous reservation, finish and webhook replay; disposable local fixture only');await db.close();
`;
new Function('require',source.replace(marker,()=>cases))(req);
