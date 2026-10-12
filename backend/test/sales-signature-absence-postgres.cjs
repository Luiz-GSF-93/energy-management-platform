// Only the named disposable PostgreSQL fixture; never accepts a connection URL.
const fs=require('node:fs'),pg=require('pg');pg.types.setTypeParser(20,Number);
const config={host:'127.0.0.1',port:55437,user:'energyos_fixture',database:'energyos_fixture',password:'disposable_fixture',application_name:'energyos_signature_disposable'};
class PgFixture{constructor(){this.client=new pg.Client(config);this.ready=this.client.connect();}async exec(sql){await this.ready;return this.client.query(sql);}async query(sql,values){await this.ready;return this.client.query(sql,values);}async close(){return this.client.end();}}
const head="const {PGlite}=require('@electric-sql/pglite'),fs=require('fs'),assert=require('node:assert/strict');";
const concurrent=String.raw`
 const {pg,config}=require('pg-fixture'),c1=new pg.Client(config),c2=new pg.Client(config);await c1.connect();await c2.connect();
 const invoke=client=>client.query('select platform_sales_signature_absence_action($1,$2,$3) v',[owner,'consume',JSON.stringify(consume)]);
 try{
  await c1.query('BEGIN');assert.equal((await invoke(c1)).rows[0].v.lease,newLease);checks++;
  const second=invoke(c2).then(()=>({ok:true}),e=>({code:e.code}));
  let waiting=false;for(let i=0;i<100;i++){const s=await db.query("select count(*) n from pg_stat_activity where application_name='energyos_signature_disposable' and wait_event='advisory'");if(s.rows[0].n>0){waiting=true;break;}await new Promise(r=>setTimeout(r,10));}
  assert.equal(waiting,true);checks++;await c1.query('COMMIT');assert.equal((await second).code,'23505');checks++;
  assert.equal((await db.query('select count(*) n from platform_sales_signature_attempts where lease=$1',[newLease])).rows[0].n,1);checks++;
 }finally{await c1.query('ROLLBACK');await c1.end();await c2.end();}
`;
const fixtureRequire=name=>{
 if(name==='pg-fixture')return {PGlite:PgFixture,pg,config};
 if(name==='node:fs')return {...fs,readFileSync:(path,...args)=>{
  let value=fs.readFileSync(path,...args);
  if(path==='test/sales-signature-recovery-sql.cjs'){if(!value.includes(head))throw Error('Fixture point changed');value=value.replace(head,"const {PGlite}=require('pg-fixture'),fs=require('fs'),assert=require('node:assert/strict');");}
  return value;
 }};
 return require(name);
};
let source=fs.readFileSync('test/sales-signature-absence-sql.cjs','utf8');
source=source.replace('// CONCURRENCY_POINT',()=>concurrent).replace("assert.equal((await absence('consume',consume)).lease,newLease);checks++;","assert.equal((await db.query('select state from platform_sales_signature_absence_resolution_events where resolution_id=$1 order by version desc limit 1',[resolutionId])).rows[0].state,'USED');checks++;");
new Function('require',source)(fixtureRequire);
