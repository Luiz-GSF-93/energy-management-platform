// Disposable database only; no OCR/AI, live tenant or financial writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
(async()=>{const db=new PGlite();let n=0;const ok=(v,m)=>{assert.ok(v,m);n++;},deny=async f=>{await assert.rejects(f);n++;};const actor='00000000-0000-4000-8000-000000000001',role='admin';
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE customers(id text,organization_id text,company_name text,document text,status text,deleted_at timestamptz);
 CREATE TABLE consumer_units(id text,organization_id text,customer_id text,consumer_unit_number text,address text,status text);
 CREATE TABLE documents(id text PRIMARY KEY,organization_id text,customer_id text,consumer_unit_id text,reference_month date,file_hash text,file_verified boolean,document_type text,blocked boolean DEFAULT false);
 CREATE TABLE roles(id text,organization_id text,name text,scope text,permissions jsonb);
 CREATE TABLE organization_members(organization_id text,user_id uuid,role_id text,status text,affiliation_type text,exclusive_customer_id text);
 CREATE TABLE platform_organization_sessions(organization_id text,user_id uuid,revoked_at timestamptz,expires_at timestamptz);
 CREATE TABLE licenses(id text,organization_id text,active boolean,status text,start_date date,end_date date,document_management boolean);
 CREATE TABLE registration_edits(id text,organization_id text,entity_kind text,entity_id text,before_record jsonb,after_record jsonb,created_at timestamptz,created_by text,reason text);
 CREATE TABLE document_ocr_jobs(id uuid PRIMARY KEY,organization_id text,document_id text,file_hash text,state text,error_code text,lease_token uuid,lease_until timestamptz,operation_url text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),next_attempt_at timestamptz DEFAULT now(),attempts integer DEFAULT 1);
 CREATE TABLE document_ocr_results(job_id uuid,organization_id text,document_id text);
 CREATE FUNCTION assert_invoice_month_ocr(text,text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF EXISTS(SELECT 1 FROM public.documents WHERE organization_id=$1 AND id=$2 AND blocked) THEN RAISE EXCEPTION 'Canonical source changed';END IF;END$$;
 CREATE FUNCTION transition_document_ocr(p_id uuid,p_token uuid,p_action text,p_operation text DEFAULT NULL,p_delay integer DEFAULT 5,p_error text DEFAULT NULL,p_result jsonb DEFAULT NULL,p_evidence jsonb DEFAULT NULL) RETURNS document_ocr_jobs LANGUAGE plpgsql AS $$DECLARE j public.document_ocr_jobs;BEGIN UPDATE public.document_ocr_jobs SET state=CASE WHEN p_action='BEGIN_SUBMISSION' THEN 'SUBMITTING' ELSE state END WHERE id=p_id AND lease_token=p_token RETURNING * INTO j;RETURN j;END$$;
 INSERT INTO customers VALUES('customer','org','Example Company','12345678000190','ACTIVE',null);
 INSERT INTO consumer_units VALUES('unit','org','customer','11111','Street 123','ACTIVE');
 INSERT INTO roles VALUES('admin','org','admin_org','organization','["8f105b02-4443-49de-b188-847e0284e7ed","92e1b670-ab10-483a-b825-c6e16799496d"]');
 INSERT INTO organization_members VALUES('org','${actor}','admin','ACTIVE','internal',null);
 INSERT INTO licenses VALUES('license','org',true,'ACTIVE',current_date-1,current_date+1,true);`);
 for(const name of ['20261130_invoice_identity_preflight.sql','20261204_ocr_identity_resume.sql','20261220_ocr_audited_installation_identity.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations',name),'utf8'));
 const rec=code=>({id:'unit',organization_id:'org',customer_id:'customer',consumer_unit_number:code});
 await db.query("INSERT INTO registration_edits VALUES('edit','org','consumer_units','unit',$1,$2,clock_timestamp()-interval '1 day',$3,'Distributor changed installation code')",[rec('22222'),rec('11111'),actor]);
 let serial=0;async function make(){const id=randomUUID(),doc='doc-'+(++serial),hash='a'.repeat(64);await db.query("INSERT INTO documents(id,organization_id,customer_id,consumer_unit_id,reference_month,file_hash,file_verified,document_type) VALUES($1,'org','customer','unit','2026-06-01',$2,true,'INVOICE_DISTRIBUTOR')",[doc,hash]);const reg=(await db.query("SELECT invoice_identity_registration('org',$1) d",[doc])).rows[0].d;const old={version:'invoice-identity-preflight-v1',state:'MISMATCH',fileHash:hash,registration:structuredClone(reg),checks:{unit:'MISMATCH',taxId:'MATCH',address:'MATCH',period:'MATCH'}};await db.query("INSERT INTO document_ocr_jobs(id,organization_id,document_id,file_hash,state,error_code,identity_preflight) VALUES($1,'org',$2,$3,'FAILED','IDENTITY_MISMATCH',$4)",[id,doc,hash,old]);return {id,doc,hash,reg,old,proof:{...old,state:'MATCH',registration:{...reg,auditedUnitNumbers:['11111','22222']},registrationEditIds:['edit'],checks:{unit:'MATCH',taxId:'MATCH',address:'MATCH',period:'MATCH'}}};}
 const call=(row,action='inspect',proof=null,request=null,reason=null,who=actor)=>db.query("SELECT ocr_identity_resume_action('org',$1,$2,$3,false,$4,$5,$6,$7) d",[row.doc,who,role,action,request,reason,proof]).then(r=>r.rows[0].d);
 const first=await make(),reason='Original and exact audited installation lineage verified.',request=randomUUID();
 let preview=await call(first);ok(!preview.eligible&&preview.canRecheck,'preflight inspection alone cannot authorize retry');
 ok((await call(first,'inspect',first.proof)).eligible,'native proof plus exact audit permits retry');
 const record=(row,proof,token)=>db.query('SELECT record_document_identity_preflight($1,$2,$3,$4)',[row.id,token,row.hash,proof]);
 const current=(row,proof)=>db.query("SELECT ocr_identity_proof_current('org',$1,$2) d",[row.doc,proof]).then(r=>r.rows[0].d);
 for(const field of ['unit','taxId','address','period']){const p=structuredClone(first.proof);p.checks[field]='REVIEW';ok(!await current(first,p));ok(!(await call(first,'inspect',p)).eligible);await deny(()=>call(first,'resume',p,randomUUID(),reason));}
 for(const alter of [p=>{delete p.registration.auditedUnitNumbers;},p=>{delete p.registrationEditIds;},p=>p.registrationEditIds=['foreign'],p=>p.registration.auditedUnitNumbers.push('99999'),p=>p.registration.unitNumber='33333',p=>p.fileHash='b'.repeat(64),p=>p.version='unknown']){const p=structuredClone(first.proof);alter(p);ok(!await current(first,p),'partial/foreign/stale proof must return false, never NULL');ok(!(await call(first,'inspect',p)).eligible);await deny(()=>call(first,'resume',p,randomUUID(),reason));}
 await deny(()=>call(first,'inspect',first.proof,null,null,'00000000-0000-4000-8000-000000000002'));
 ok((await call(first,'resume',first.proof,request,reason)).state==='QUEUED');ok((await call(first,'resume',first.proof,request,reason)).replayed);
 let saved=(await db.query('SELECT * FROM document_ocr_jobs WHERE id=$1',[first.id])).rows[0];ok(saved.identity_resume_history.length===1&&saved.identity_preflight===null);ok(saved.identity_resume_history[0].basis==='AUDITED_INSTALLATION_ALIAS'&&saved.identity_resume_history[0].previousProof.checks.unit==='MISMATCH');
 await deny(()=>call(first,'resume',first.proof,request,reason+' changed'));
 await deny(()=>db.query("UPDATE document_ocr_jobs SET identity_resume_history='[]' WHERE id=$1",[first.id]));
 const token=randomUUID();await db.query("UPDATE document_ocr_jobs SET lease_token=$2,lease_until=now()+interval '1 minute' WHERE id=$1",[first.id,token]);
 await record(first,first.proof,token);await db.query("SELECT transition_document_ocr($1,$2,'BEGIN_SUBMISSION')",[first.id,token]);
 saved=(await db.query('SELECT * FROM document_ocr_jobs WHERE id=$1',[first.id])).rows[0];ok(saved.state==='SUBMITTING'&&saved.submission_started_at!==null,'initial OCR intent still recorded before provider');
 for(const tweak of ["submission_started_at=now()","operation_url='private-operation'","lease_token='00000000-0000-4000-8000-000000000099'","attempts=120","state='SUBMISSION_UNKNOWN'","error_code='SOURCE_INVALID'"]){const row=await make();await db.exec(`UPDATE document_ocr_jobs SET ${tweak} WHERE id='${row.id}'`);ok(!(await call(row,'inspect',row.proof)).eligible);ok(!(await call(row)).canRecheck);await deny(()=>call(row,'resume',row.proof,randomUUID(),reason));}
 for(const field of ['taxId','address','period']){const row=await make();row.old.checks[field]='MISMATCH';await db.query('UPDATE document_ocr_jobs SET identity_preflight=$2 WHERE id=$1',[row.id,row.old]);ok(!(await call(row)).canRecheck);await deny(()=>call(row,'resume',row.proof,randomUUID(),reason));}
 const result=await make();await db.query("INSERT INTO document_ocr_results VALUES($1,'org',$2)",[result.id,result.doc]);ok(!(await call(result)).canRecheck);
 const changed=await make();await db.query("UPDATE documents SET file_hash=$2 WHERE id=$1",[changed.doc,'c'.repeat(64)]);ok(!(await call(changed)).canRecheck);
 const duplicate=await make();await db.query('UPDATE documents SET blocked=true WHERE id=$1',[duplicate.doc]);await deny(()=>call(duplicate,'inspect',duplicate.proof));
 const badAudit=await make();for(const update of ["organization_id='foreign'","entity_id='foreign'","created_by=null","reason='x'","before_record=jsonb_set(before_record,'{customer_id}','\"foreign\"')"]){await db.exec('BEGIN');await db.exec('UPDATE registration_edits SET '+update);ok(!await current(badAudit,badAudit.proof));ok(!(await call(badAudit)).canRecheck);await db.exec('ROLLBACK');}
 // New jobs use the same SQL proof check as the initial worker preflight and BEGIN_SUBMISSION.
 const fresh=await make(),lease=randomUUID();await db.query("UPDATE document_ocr_jobs SET state='QUEUED',identity_preflight=null,lease_token=$2,lease_until=now()+interval '1 minute' WHERE id=$1",[fresh.id,lease]);
 const forged=structuredClone(fresh.proof);delete forged.registration.auditedUnitNumbers;await deny(()=>record(fresh,forged,lease));await record(fresh,fresh.proof,lease);
 await db.exec('BEGIN');await db.exec("UPDATE registration_edits SET organization_id='foreign'");await deny(()=>db.query("SELECT transition_document_ocr($1,$2,'BEGIN_SUBMISSION')",[fresh.id,lease]));await db.exec('ROLLBACK');
 // Legacy registration-change recovery remains valid.
 const legacy=await make();legacy.old.registration.unitNumber='33333';await db.query('UPDATE document_ocr_jobs SET identity_preflight=$2 WHERE id=$1',[legacy.id,legacy.old]);await db.query("INSERT INTO registration_edits VALUES('legacy-edit','org','consumer_units','unit',$1,$2,clock_timestamp(),$3,'Registration corrected after failure')",[rec('33333'),rec('11111'),actor]);ok((await call(legacy)).eligible);const direct={...legacy.proof,registration:legacy.reg};delete direct.registrationEditIds;ok((await call(legacy,'resume',direct,randomUUID(),reason)).state==='QUEUED');
 // Model the canonical immutable intake-alias projection independently of
 // configuration edits, then exercise the real preflight/recovery guards.
 await db.exec(`CREATE TABLE test_intake_alias_sources(organization_id text,customer_id text,unit_id text,current_code text,previous_code text,id text);
 ALTER FUNCTION ocr_identity_unit_lineage(text,text,text,text) RENAME TO lineage_configuration_test;
 CREATE FUNCTION ocr_identity_unit_lineage(p_org text,p_customer text,p_unit text,p_current text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT base||jsonb_build_object('codes',CASE WHEN EXISTS(SELECT 1 FROM public.test_intake_alias_sources WHERE organization_id=$1 AND customer_id=$2 AND unit_id=$3 AND current_code=$4) THEN jsonb_build_array($4,'22222') ELSE base->'codes' END,'aliasIds',coalesce((SELECT jsonb_agg(id) FROM public.test_intake_alias_sources WHERE organization_id=$1 AND customer_id=$2 AND unit_id=$3 AND current_code=$4),'[]'::jsonb)) FROM public.lineage_configuration_test($1,$2,$3,$4)base $$;
 REVOKE ALL ON FUNCTION ocr_identity_unit_lineage(text,text,text,text) FROM PUBLIC;`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261237_native_identity_intake_aliases.sql'),'utf8'));
 await db.exec('BEGIN');
 await db.exec("UPDATE registration_edits SET organization_id='foreign';INSERT INTO test_intake_alias_sources VALUES('org','customer','unit','11111','22222','alias-source');");
 const alias=await make(),aliasProof={...alias.proof,registrationAliasIds:['alias-source']};delete aliasProof.registrationEditIds;
 ok(await current(alias,aliasProof),'immutable intake alias is accepted without a configuration edit');
 const nativeLineage=async(org='org',customer='customer',unit='unit',hash=alias.hash)=>(await db.query('SELECT ocr_identity_native_lineage($1,$2,$3,$4,$5) d',[org,customer,unit,alias.doc,hash])).rows[0].d;
 ok((await nativeLineage()).aliasIds[0]==='alias-source');for(const args of [['foreign'],['org','foreign'],['org','customer','foreign'],['org','customer','unit','c'.repeat(64)]])ok(await nativeLineage(...args)===null);
 ok((await call(alias)).canRecheck);ok((await call(alias,'inspect',aliasProof)).eligible);
 for(const alter of [p=>p.registrationAliasIds=['foreign'],p=>delete p.registrationAliasIds,p=>p.registration.auditedUnitNumbers.push('99999'),p=>p.checks.taxId='REVIEW',p=>p.fileHash='c'.repeat(64)]){const p=structuredClone(aliasProof);alter(p);ok(!await current(alias,p));await db.exec('SAVEPOINT rejected_alias');await deny(()=>call(alias,'resume',p,randomUUID(),reason));await db.exec('ROLLBACK TO SAVEPOINT rejected_alias;RELEASE SAVEPOINT rejected_alias');}
 await db.exec("UPDATE test_intake_alias_sources SET organization_id='foreign'");ok(!await current(alias,aliasProof));await db.exec("UPDATE test_intake_alias_sources SET organization_id='org'");
 ok((await call(alias,'resume',aliasProof,randomUUID(),reason)).state==='QUEUED');
 const aliasLease=randomUUID();await db.query("UPDATE document_ocr_jobs SET lease_token=$2,lease_until=now()+interval '1 minute' WHERE id=$1",[alias.id,aliasLease]);await record(alias,aliasProof,aliasLease);await db.query("SELECT transition_document_ocr($1,$2,'BEGIN_SUBMISSION')",[alias.id,aliasLease]);
 ok((await db.query('SELECT state FROM document_ocr_jobs WHERE id=$1',[alias.id])).rows[0].state==='SUBMITTING');
 await db.exec('ROLLBACK');
 await db.exec("UPDATE licenses SET active=false");const noLicense=await make();await deny(()=>call(noLicense));await db.exec("UPDATE licenses SET active=true");
 await db.exec('SET ROLE authenticated');await deny(()=>db.query("SELECT ocr_identity_unit_lineage('org','customer','unit','11111')"));await deny(()=>db.query("SELECT ocr_identity_proof_current('org','doc','{}')"));await deny(()=>db.query("SELECT ocr_identity_native_lineage('org','customer','unit','doc','hash')"));await db.exec('RESET ROLE');
 console.log(n+' audited-installation SQL checks passed');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
