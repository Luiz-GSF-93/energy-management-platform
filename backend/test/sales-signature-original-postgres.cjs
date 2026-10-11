// Run only against the named disposable local fixture (never accepts a database URL).
// docker run --rm -d --name energyos-signature-pg-fixture -p 127.0.0.1:55437:5432
//   -e POSTGRES_USER=energyos_fixture -e POSTGRES_DB=energyos_fixture
//   -e POSTGRES_PASSWORD=disposable_fixture postgres:17
// Client pg@8.16.3 can be installed in a temporary prefix and supplied through NODE_PATH.
const fs=require('node:fs'),pg=require('pg');
pg.types.setTypeParser(20,Number);
const config={host:'127.0.0.1',port:55437,user:'energyos_fixture',database:'energyos_fixture',password:'disposable_fixture',application_name:'energyos_signature_disposable'};
class PgFixture{
 constructor(){this.client=new pg.Client(config);this.ready=this.client.connect();}
 async exec(sql){await this.ready;return this.client.query(sql);}
 async query(sql,values){await this.ready;return this.client.query(sql,values);}
 async close(){return this.client.end();}
}
const head="const {PGlite}=require('@electric-sql/pglite'),fs=require('fs'),assert=require('node:assert/strict');";
const requireFixture=name=>{
 if(name==='pg-fixture')return {PGlite:PgFixture,pg,config};
 if(name==='node:fs')return {...fs,readFileSync:(path,...args)=>{
  const text=fs.readFileSync(path,...args);
  if(path!=='test/sales-signature-recovery-sql.cjs')return text;
  if(!text.includes(head))throw Error('PostgreSQL fixture insertion point changed');
  return text.replace(head,"const {PGlite}=require('pg-fixture'),fs=require('fs'),assert=require('node:assert/strict');");
 }};
 return require(name);
};
const source=fs.readFileSync('test/sales-signature-original-sql.cjs','utf8');
const marker=" console.log('PASS',checks,'signature/original SQL checks; no network or shared database');await db.close();";
if(!source.includes(marker))throw Error('Concurrency insertion point changed');
const concurrent=String.raw`
 const {pg,config}=require('pg-fixture');const c1=new pg.Client(config),c2=new pg.Client(config);await c1.connect();await c2.connect();
 const invoke=(client,action,body)=>client.query('select platform_sales_signature_original_action($1,$2,$3) v',[owner,action,JSON.stringify(body)]);
 async function waitForBlocked(){for(let i=0;i<100;i++){const s=await db.query("select count(*) n from pg_stat_activity where application_name='energyos_signature_disposable' and wait_event='advisory'");if(s.rows[0].n>0)return;await new Promise(r=>setTimeout(r,10));}throw Error('Second session did not wait on reservation lock');}
 try{
  const b1={...retryBody,requestId:id(410)},b2={...retryBody,requestId:id(411)};
  await c1.query('BEGIN');await invoke(c1,'begin',b1);
  const blocked=invoke(c2,'begin',b2).then(()=>({ok:true}),e=>({code:e.code}));
  await waitForBlocked();checks++;await c1.query('COMMIT');assert.equal((await blocked).code,'23505');checks++;
  assert.equal((await db.query('select count(*) n from platform_sales_signature_original_checks where request_id in ($1,$2)',[b1.requestId,b2.requestId])).rows[0].n,1);checks++;
  const completion={id:request2,requestId:b1.requestId,result:originalProof};
  await c1.query('BEGIN');await invoke(c1,'complete',completion);
  const replay=invoke(c2,'complete',completion);await waitForBlocked();checks++;await c1.query('COMMIT');assert.equal((await replay).rows[0].v.replayed,true);checks++;
  assert.equal((await db.query('select count(*) n from platform_sales_signature_original_results where request_id=$1',[b1.requestId])).rows[0].n,1);checks++;
 }finally{await c1.query('ROLLBACK');await c1.end();await c2.end();}
 console.log('PASS',checks,'PostgreSQL signature/original checks, including simultaneous sessions; disposable local fixture only');await db.close();
`;
new Function('require',source.replace(marker,concurrent))(requireFixture);
