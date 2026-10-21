// Runs in the same disposable Portal database, including the real PostgreSQL adapter.
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
module.exports=async function testResume(db,actor,role,external,externalRole,ok,deny){
 await db.exec(`CREATE TABLE licenses(id text,organization_id text,active boolean,status text,start_date date,end_date date,document_management boolean);
 INSERT INTO licenses VALUES('license','org',true,'active',current_date-1,current_date+1,true);
 CREATE TABLE registration_edits(organization_id text,entity_kind text,entity_id text,before_record jsonb,after_record jsonb,created_at timestamptz);
 CREATE TABLE IF NOT EXISTS document_ocr_results(job_id uuid,organization_id text,document_id text);
 ALTER TABLE document_ocr_jobs ADD COLUMN operation_url text,ADD COLUMN created_at timestamptz DEFAULT now(),ADD COLUMN updated_at timestamptz DEFAULT now(),ADD COLUMN next_attempt_at timestamptz DEFAULT now(),ADD COLUMN attempts integer DEFAULT 1;
 INSERT INTO consumer_units(id,organization_id,customer_id,status,name,consumer_unit_number,address) VALUES('resume-unit','org','customer','ACTIVE','Resume unit','0012345678','Street 123');`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261204_ocr_identity_resume.sql'),'utf8'));
 await db.query('UPDATE roles SET permissions=permissions||$1::jsonb WHERE id=$2',[JSON.stringify(['92e1b670-ab10-483a-b825-c6e16799496d']),role]);
 const make=async(month)=>{const id=randomUUID(),doc='resume-'+month,hash=String(month).repeat(64).slice(0,64);
  await db.query("INSERT INTO documents(id,organization_id,customer_id,consumer_unit_id,file_hash,file_verified,reference_month,document_type) VALUES($1,'org','customer','resume-unit',$2,true,$3,'INVOICE_DISTRIBUTOR')",[doc,hash,`2027-${String(month).padStart(2,'0')}-01`]);
  const reg=(await db.query("SELECT invoice_identity_registration('org',$1) data",[doc])).rows[0].data;
  const old={...reg,unitNumber:'0012345678'};
  const proof={version:'invoice-identity-preflight-v1',fileHash:hash,state:'MISMATCH',registration:old,checks:{unit:'MISMATCH',taxId:'MATCH',address:'MATCH',period:'MATCH'}};
  await db.query("INSERT INTO document_ocr_jobs(id,organization_id,document_id,file_hash,state,error_code,identity_preflight,created_at) VALUES($1,'org',$2,$3,'FAILED','IDENTITY_MISMATCH',$4,clock_timestamp()-interval '1 minute')",[id,doc,hash,proof]);
  return {id,doc,hash,proof};
 };
 const first=await make(1);
 const call=(action,row,proof=null,request=null,reason=null,who=actor,r=role)=>db.query("SELECT ocr_identity_resume_action('org',$1,$2,$3,false,$4,$5,$6,$7) data",[row.doc,who,r,action,request,reason,proof]).then(r=>r.rows[0].data);
 ok(!(await call('inspect',first)).eligible);
 await db.query("UPDATE consumer_units SET consumer_unit_number='16873262' WHERE id='resume-unit'");
 // A raw changed row is insufficient without the corresponding audit.
 ok(!(await call('inspect',first)).eligible);
 await db.exec(`INSERT INTO registration_edits VALUES('org','consumer_units','resume-unit','{"consumer_unit_number":"0012345678"}','{"consumer_unit_number":"16873262"}',clock_timestamp())`);
 ok((await call('inspect',first)).eligible);
 await deny(()=>call('inspect',first,null,null,null,external,externalRole));
 const proofFor=async(row)=>({version:'invoice-identity-preflight-v1',fileHash:row.hash,state:'MATCH',registration:(await db.query("SELECT invoice_identity_registration('org',$1) data",[row.doc])).rows[0].data,checks:{unit:'MATCH',taxId:'MATCH',address:'MATCH',period:'MATCH'}});
 const proof=await proofFor(first),request=randomUUID(),reason='Cadastro corrigido e original conferido para retomada.';
 await deny(()=>call('resume',first,{...proof,checks:{...proof.checks,unit:'REVIEW'}},request,reason));
 await deny(()=>call('resume',first,{...proof,fileHash:'f'.repeat(64)},request,reason));
 await deny(()=>call('resume',first,proof,request,'curta'));
 const resumed=await call('resume',first,proof,request,reason);ok(resumed.state==='QUEUED'&&!resumed.replayed);
 const saved=(await db.query('SELECT * FROM document_ocr_jobs WHERE id=$1',[first.id])).rows[0];
 ok(saved.identity_preflight===null&&saved.identity_resume_history.length===1&&saved.attempts===1);
 ok(saved.identity_resume_history[0].previousProof.registration.unitNumber==='0012345678');
 ok(saved.identity_resume_history[0].newProof.registration.unitNumber==='16873262');
 ok((await call('resume',first,proof,request,reason)).replayed);
 await deny(()=>call('resume',first,proof,request,reason+' altered'));
 await deny(()=>db.query("UPDATE document_ocr_jobs SET identity_resume_history='[]' WHERE id=$1",[first.id]));
 await db.query("UPDATE document_ocr_jobs SET state='SUBMITTING' WHERE id=$1",[first.id]);
 ok((await db.query('SELECT submission_started_at IS NOT NULL yes FROM document_ocr_jobs WHERE id=$1',[first.id])).rows[0].yes);
 await deny(()=>db.query('UPDATE document_ocr_jobs SET submission_started_at=NULL WHERE id=$1',[first.id]));
 const denyRow=await make(2),denyProof=await proofFor(denyRow);
 for(const state of ['SUBMITTING','POLLING','SUCCEEDED','SUBMISSION_UNKNOWN']){
  await db.query('UPDATE document_ocr_jobs SET state=$1 WHERE id=$2',[state,denyRow.id]);
  ok(!(await call('inspect',denyRow)).eligible);
  await deny(()=>call('resume',denyRow,denyProof,randomUUID(),reason));
 }
 await db.query("UPDATE document_ocr_jobs SET state='FAILED',error_code='IDENTITY_MISMATCH' WHERE id=$1",[denyRow.id]);
 ok(!(await call('inspect',denyRow)).eligible); // Past submission intent remains terminal.
 const resultRow=await make(3);await db.query("INSERT INTO document_ocr_results(job_id,organization_id,document_id) VALUES($1,'org',$2)",[resultRow.id,resultRow.doc]);ok(!(await call('inspect',resultRow)).eligible);
 const leaseRow=await make(4);await db.query('UPDATE document_ocr_jobs SET lease_token=$1,lease_until=now()+interval \'1 minute\' WHERE id=$2',[randomUUID(),leaseRow.id]);ok(!(await call('inspect',leaseRow)).eligible);
 const sourceRow=await make(5);await db.query("UPDATE documents SET file_hash=$1 WHERE id=$2",['f'.repeat(64),sourceRow.doc]);ok(!(await call('inspect',sourceRow)).eligible);
 await db.exec("UPDATE licenses SET active=false");await deny(()=>call('inspect',first));await db.exec("UPDATE licenses SET active=true");
 if(db.race){
  const row=await make(6),p=await proofFor(row),req=randomUUID();
  const query="SELECT ocr_identity_resume_action('org',$1,$2,$3,false,'resume',$4,$5,$6) data",args=[row.doc,actor,role,req,reason,JSON.stringify(p)];
  const results=await db.race(query,args,args);ok(results.every(r=>r.status==='fulfilled'));
  ok(results.filter(r=>r.value.rows[0].data.replayed).length===1);
  ok((await db.query('SELECT jsonb_array_length(identity_resume_history) n FROM document_ocr_jobs WHERE id=$1',[row.id])).rows[0].n===1);
 }
 await db.exec('SET ROLE authenticated');await deny(()=>call('inspect',first));await db.exec('RESET ROLE');
};
