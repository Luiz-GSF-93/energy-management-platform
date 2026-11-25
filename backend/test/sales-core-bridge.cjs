// Disposable PGlite only. No credentials, Asaas calls or production writes.
const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();let checks=0;const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),owner=id(1),other=id(2);
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE platform_sales_leads(receipt uuid PRIMARY KEY,payload jsonb NOT NULL,created_at timestamptz DEFAULT now());
 CREATE TABLE platform_sales_proposals(id uuid PRIMARY KEY,receipt uuid NOT NULL);
 CREATE FUNCTION platform_team_owner(a uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF a IS DISTINCT FROM '${owner}'::uuid THEN RAISE EXCEPTION 'Owner only' USING ERRCODE='42501'; END IF; END $$;`);
 const sql=fs.readFileSync('src/database/migrations/20261362_platform_sales_energy_core_bridge.sql','utf8');await db.exec(sql);await db.exec(sql);
 const run=(a,b={},actor=null)=>db.query('SELECT platform_sales_core_bridge($1,$2,$3) result',[actor,a,JSON.stringify(b)]).then(r=>r.rows[0].result);
 const reject=async(f,code)=>{await assert.rejects(f,e=>e.code===code);checks++;};
 const insert=n=>db.query('INSERT INTO platform_sales_leads(receipt,payload) VALUES($1,$2)',[id(n),JSON.stringify({requestId:id(n),company:'Synthetic only',email:'fixture@example.test',consent:true,consentVersion:'sales-contact-v1',website:'',emailKind:'CORPORATE'})]);
 await insert(10);assert.equal((await run('status',{},owner)).counts.QUEUED,undefined);checks++;
 await reject(()=>run('claim',{requestId:id(100)}),'42501');await reject(()=>run('routing',{enabled:true,reason:'Fixture authorized routing only.'},other),'42501');
 await run('routing',{enabled:true,reason:'Fixture authorized routing only.'},owner);await insert(11);await insert(12);
 await reject(()=>db.query('INSERT INTO platform_sales_proposals VALUES($1,$2)',[id(900),id(11)]),'P3652');
 await db.query('INSERT INTO platform_sales_proposals VALUES($1,$2)',[id(901),id(10)]);checks++;
 const claim=await run('claim',{requestId:id(100)});assert.equal(claim.requests.length,2);assert.equal(claim.requests[0].lead.emailKind,undefined);assert.equal(claim.requests[0].lead.requestId,undefined);checks++;
 assert.deepEqual(await run('claim',{requestId:id(100)}),claim);checks++;
 assert.equal((await run('claim',{requestId:id(101)})).requests.length,0);checks++;
 await reject(()=>run('ack',{receipt:id(11),leaseId:id(101),coreRequestId:'core-11'}),'P3650');
 const ack={receipt:id(11),leaseId:id(100),coreRequestId:'core-11'};assert.equal((await run('ack',ack)).state,'ACCEPTED');assert.deepEqual(await run('ack',ack),await run('ack',ack));checks++;
 const event={receipt:id(11),eventId:id(200),revision:1,status:'PROPOSAL_PREPARED',proposalRef:'p-11',digest:'a'.repeat(64)};
 assert.equal((await run('update',event)).licenseActivated,false);assert.equal((await run('update',event)).duplicate,true);checks++;
 await reject(()=>run('update',{...event,digest:'b'.repeat(64)}),'P3650');await reject(()=>run('update',{...event,eventId:id(201)}),'P3650');await reject(()=>run('update',{...event,eventId:id(202),receipt:id(12)}),'P3650');
 await run('update',{...event,eventId:id(203),revision:2,status:'CONTRACT_SIGNED',contractRef:'c-11'});
 await reject(()=>run('update',{...event,eventId:id(204),revision:3}),'P3650');
 // Simulate crash/lease expiration and stale acknowledgement.
 await db.exec(`UPDATE platform_sales_core_outbox SET lease_until=now()-interval '1 second' WHERE receipt='${id(12)}'`);
 const recovered=await run('claim',{requestId:id(102)});assert.equal(recovered.requests[0].receipt,id(12));checks++;
 await reject(()=>run('ack',{receipt:id(12),leaseId:id(100),coreRequestId:'core-12'}),'P3650');
 await db.exec(`UPDATE platform_sales_core_outbox SET attempts=10,lease_until=now()-interval '1 second' WHERE receipt='${id(12)}'`);await run('claim',{requestId:id(103)});
 assert.equal((await run('status',{},owner)).counts.DEAD_LETTER,1);checks++;await run('retry',{receipt:id(12),reason:'Retry explicitly authorized in fixture.'},owner);checks++;
 // Erasure removes pending payload access and commercial references.
 await db.query('DELETE FROM platform_sales_leads WHERE receipt=$1',[id(12)]);assert.equal((await run('claim',{requestId:id(104)})).requests.length,0);checks++;
 for(const role of ['anon','authenticated','service_role']){const p=await db.query("select has_table_privilege($1,'platform_sales_core_outbox','select') allowed",[role]);assert.equal(p.rows[0].allowed,false);checks++;}
 for(const role of ['anon','authenticated']){const p=await db.query("select has_function_privilege($1,'platform_sales_core_bridge(uuid,text,jsonb)','execute') allowed",[role]);assert.equal(p.rows[0].allowed,false);checks++;}
 assert.equal((await db.query('SELECT count(*) n FROM platform_sales_proposals')).rows[0].n,1);checks++;
 await db.close();console.log('Energy Core bridge: '+checks+' SQL checks passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
