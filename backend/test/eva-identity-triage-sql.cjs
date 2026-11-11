const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),assert=require('node:assert/strict');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
(async()=>{const db=new PGlite();let checks=0;const ok=v=>{assert(v);checks++},deny=async f=>{await assert.rejects(f);checks++};try{
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
CREATE TABLE organizations(id text PRIMARY KEY);INSERT INTO organizations VALUES('org'),('other');
CREATE TABLE customers(id text PRIMARY KEY,organization_id text,document text,company_name text,status text,deleted_at timestamptz);
INSERT INTO customers VALUES('client','org','12345678000190','Client','ACTIVE',NULL),('foreign','other','98765432000100','Other','ACTIVE',NULL);
CREATE TABLE consumer_units(id text PRIMARY KEY,organization_id text,customer_id text,consumer_unit_number text,address text,status text);
INSERT INTO consumer_units VALUES('${id(1)}','org','client','1234567','Rua Exemplo 123','ACTIVE');
CREATE TABLE roles(id text PRIMARY KEY,organization_id text,scope text,name text,permissions jsonb);
INSERT INTO roles VALUES('manager','org','organization','gestor','["8f105b02-4443-49de-b188-847e0284e7ed","8f3ff5eb-157a-468a-91af-6f89d92e23a7","92e1b670-ab10-483a-b825-c6e16799496d","60f9690a-145b-4dba-b23f-9f945baca296","beb6ec90-8ba8-40ce-a156-aeef6cc75cce"]'),('external','org','organization','consulta','[]');
CREATE TABLE organization_members(organization_id text,user_id text,role_id text,status text,affiliation_type text,exclusive_customer_id text);
INSERT INTO organization_members VALUES('org','${id(71)}','manager','ACTIVE','internal',NULL),('org','${id(70)}','external','ACTIVE','external','client');
CREATE TABLE licenses(id text PRIMARY KEY,organization_id text,active boolean,status text,start_date date,end_date date,document_management boolean,documents_unlimited boolean,documents_limit int,plan_id text);
INSERT INTO licenses VALUES('license','org',true,'active','2020-01-01','2099-01-01',true,false,10,'plan');
CREATE TABLE portal_service_routing(id uuid,organization_id text,kind text,owner_user_id text,revision int,body jsonb);
INSERT INTO portal_service_routing VALUES('${id(90)}','org','ROUTING','organization',1,'{"enabled":true,"automationEnabled":true,"automationActor":"${id(71)}"}');
CREATE TABLE documents(id text PRIMARY KEY,organization_id text,customer_id text,consumer_unit_id text,document_type text,reference_month date,original_filename text,mime_type text,file_hash text,file_size_bytes int,file_path text,storage_bucket text,file_verified boolean,file_verified_at timestamptz,uploaded_by_auth_user_id uuid,license_check_passed boolean,processing_status text,ocr_status text,description text);
CREATE TABLE document_ocr_jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text,document_id text,file_hash text,requested_by text,state text,operation_url text,UNIQUE(organization_id,document_id));
CREATE TABLE document_ocr_results(job_id uuid PRIMARY KEY,organization_id text,document_id text,file_hash text,raw_result jsonb,evidence jsonb);
CREATE TABLE eva_assisted_closing_versions(id uuid PRIMARY KEY,organization_id text,customer_id text,month text,report jsonb);
CREATE TABLE eva_assisted_closing_events(closing_id uuid,state text,sequence int DEFAULT 1);
CREATE FUNCTION preserve_operation_history() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$BEGIN RAISE EXCEPTION 'Immutable';END$$;
CREATE FUNCTION organization_resource_usage(text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('documents',(SELECT count(*) FROM public.documents WHERE organization_id=$1),'users',1,'units',1)$$;
CREATE FUNCTION portal_workspace_actor(o text,a text,r text,p boolean,m text) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$DECLARE x organization_members;BEGIN SELECT * INTO x FROM organization_members WHERE organization_id=o AND user_id=a AND role_id=r AND status='ACTIVE';IF NOT FOUND THEN RAISE EXCEPTION 'Denied';END IF;RETURN jsonb_build_object('external',x.affiliation_type='external','customerId',x.exclusive_customer_id);END$$;
CREATE FUNCTION assert_invoice_month_ocr(text,text) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$BEGIN RETURN;END$$;
CREATE FUNCTION ocr_identity_unit_lineage(o text,c text,u text,n text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('codes',jsonb_build_array(n),'editIds','[]'::jsonb)$$;
CREATE FUNCTION quota_check() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$DECLARE n int;BEGIN n:=(organization_resource_usage(NEW.organization_id)->>'documents')::int;IF n>=(SELECT documents_limit FROM licenses WHERE organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'quota';END IF;RETURN NEW;END$$;
CREATE TRIGGER quota_check BEFORE INSERT ON documents FOR EACH ROW EXECUTE FUNCTION quota_check();
`);
await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261222_eva_automatic_intake.sql','utf8'));
await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261223_eva_intake_pending_queue.sql','utf8'));
await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261224_eva_intake_status.sql','utf8'));
await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261225_eva_intake_unit_aliases.sql','utf8'));
await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261226_eva_archived_intake_tracking.sql','utf8'));
await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261227_eva_intake_alias_evidence.sql','utf8'));

await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261245_eva_intake_administration.sql','utf8'));
await db.exec(`CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid,raw_user_meta_data jsonb,email text);
CREATE FUNCTION public.ocr_identity_native_lineage(p_org text,p_customer text,p_unit text,p_document text,p_hash text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('codes',jsonb_build_array('1234567'),'editIds','[]'::jsonb,'aliasIds','[]'::jsonb)$$;
CREATE FUNCTION public.ocr_identity_proof_current(p_org text,p_document text,p_proof jsonb) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
CREATE SCHEMA portal_scope;CREATE TABLE portal_scope.routines(original_oid oid,source_hash text);CREATE FUNCTION portal_scope.function_signature(oid) RETURNS text LANGUAGE sql AS $$SELECT 'test'::text$$;
CREATE FUNCTION portal_scope.ocr_identity_native_lineage(p_org text,p_customer text,p_unit text,p_document text,p_hash text) RETURNS jsonb LANGUAGE sql AS $$SELECT public.ocr_identity_native_lineage(p_org,p_customer,p_unit,p_document,p_hash)$$;
CREATE FUNCTION portal_scope.ocr_identity_proof_current(p_org text,p_document text,p_proof jsonb) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
CREATE FUNCTION public.invoice_identity_registration(text,text) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
`);
await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261277_eva_identity_triage.sql','utf8'));
const actor=id(71),intake=id(200),fp='a'.repeat(64),hash='b'.repeat(64),token=id(210);
await db.query(`INSERT INTO eva_automatic_intakes(id,organization_id,customer_id,actor_id,role_id,platform,external,request_id,file_hash,filename,mime,size_bytes,consent,hints,state,stored,lease_token,lease_until) VALUES($1,'org','client',$2,'manager',false,false,$3,$4,'test.pdf','application/pdf',100,true,$5,'RECOGNIZING',true,$6,clock_timestamp()+interval '1 minute')`,[intake,actor,id(201),hash,JSON.stringify({unitId:id(1),month:'2026-01'}),token]);
const diagnostic={version:'intake-identity-triage-1',fingerprint:fp,fileHash:hash,registration:{customerId:'client',unitId:id(1),unitNumber:'1234567',taxId:'12345678000190',address:'Rua Exemplo 123',month:'2026-01'},fields:[{key:'taxId',status:'MATCH'},{key:'address',status:'MATCH'},{key:'unit',status:'MISMATCH',expected:'1234567',found:['7654321']},{key:'period',status:'MATCH'}],read:true,action:'CONTINUE_JUSTIFIED',unitCode:'7654321'};
const work=()=>db.query('SELECT eva_intake_identity_work($1,$2,$3) data',[intake,token,JSON.stringify(diagnostic)]).then(r=>r.rows[0].data);
ok((await work()).accepted===false);
await db.exec(`UPDATE eva_automatic_intakes SET state='REVIEW_REQUIRED',lease_token=NULL,lease_until=NULL WHERE id='${intake}'`);
const decide=(body,who=actor,role='manager',org='org')=>db.query("SELECT eva_intake_identity_action($1,$2,$3,false,'decide',$4,$5) data",[org,who,role,intake,JSON.stringify(body)]).then(r=>r.rows[0].data);
const listed=await db.query("SELECT eva_intake_identity_action('org',$1,'manager',false,'list',NULL,$2) data",[actor,JSON.stringify({ids:[intake]})]);ok(listed.rows[0].data.items[0].diagnostic.unitCode==='7654321');
const body={fingerprint:fp,decision:'CONTINUE',reason:'UC histórica conferida no original para esta unidade.'};
await deny(()=>decide(body,id(70),'external'));
await deny(()=>decide({...body,fingerprint:'c'.repeat(64)}));
await deny(()=>decide({...body,reason:'curta'}));
ok((await decide(body)).decision==='CONTINUE');
ok((await decide(body)).replayed===true);
await db.exec(`UPDATE eva_automatic_intakes SET lease_token='${token}',lease_until=clock_timestamp()+interval '1 minute' WHERE id='${intake}'`);
ok((await work()).unitCode==='7654321');
await deny(()=>db.exec("UPDATE eva_intake_identity_reviews SET reason='changed'"));
await db.exec(`UPDATE consumer_units SET address='Rua alterada 999' WHERE id='${id(1)}'`);
await deny(work);
await db.exec(`UPDATE consumer_units SET address='Rua Exemplo 123' WHERE id='${id(1)}'`);
await deny(()=>decide(body,actor,'manager','other'));
await db.exec(`SET ROLE service_role`);await deny(()=>db.query('SELECT * FROM eva_intake_identity_reviews'));await db.exec('RESET ROLE');
const scoped=await db.query("SELECT portal_scope.ocr_identity_native_lineage('org','client',$1,'different-document',$2) data",[id(1),hash]);ok(scoped.rows[0].data.reviewIds.length===0);
const refs=await db.query("SELECT eva_intake_identity_refs('other','[]'::jsonb) data");ok(refs.rows[0].data.length===0);

await db.exec(`INSERT INTO roles SELECT 'admin',organization_id,scope,'admin_org',permissions FROM roles WHERE id='manager';INSERT INTO organization_members VALUES('org','${id(72)}','admin','ACTIVE','internal',NULL)`);
const n=id(300);await db.query(`INSERT INTO eva_automatic_intakes(id,organization_id,customer_id,actor_id,role_id,platform,external,request_id,file_hash,filename,mime,size_bytes,consent,hints,state,stored,lease_token,lease_until) VALUES($1,'org','client',$2,'manager',false,false,$3,$4,'nf.pdf','application/pdf',100,true,$5,'RECOGNIZING',true,$6,clock_timestamp()+interval '1 minute')`,[n,actor,id(301),'d'.repeat(64),JSON.stringify({unitId:id(1),month:'2026-01'}),token]);
const addressDiag={...diagnostic,fileHash:'d'.repeat(64),fingerprint:'c'.repeat(64),documentType:'INVOICE_SUPPLIER',action:'REVIEW',unitCode:null,fields:[{key:'taxId',status:'MATCH'},{key:'address',status:'MISMATCH',expected:'Rua Exemplo 123',found:['Rodovia Alternativa, km 55, s/n']},{key:'unit',status:'INCONCLUSIVE'},{key:'period',status:'MATCH'}]};
await db.query('SELECT eva_intake_identity_work($1,$2,$3)',[n,token,JSON.stringify(addressDiag)]);await db.query("UPDATE eva_automatic_intakes SET state='REVIEW_REQUIRED',lease_token=NULL,lease_until=NULL WHERE id=$1",[n]);
const addressBody={fingerprint:addressDiag.fingerprint,decision:'CONTINUE',reason:'Administrador confirmou estes dois endereços na mesma Matriz e documento.'};
const addressCall=(a,role)=>db.query("SELECT eva_intake_identity_action('org',$1,$2,false,'address',$3,$4) data",[a,role,n,JSON.stringify(addressBody)]);
await deny(()=>addressCall(actor,'manager'));ok((await addressCall(id(72),'admin')).rows[0].data.decision==='ADDRESS');
await db.query("UPDATE eva_automatic_intakes SET lease_token=$2,lease_until=clock_timestamp()+interval '1 minute' WHERE id=$1",[n,token]);const acceptedAddress=await db.query('SELECT eva_intake_identity_work($1,$2,$3) data',[n,token,JSON.stringify(addressDiag)]);ok(acceptedAddress.rows[0].data.address==='Rodovia Alternativa, km 55, s/n');
for(const [ix,action] of [[400,'REJECT'],[500,'REVIEW']]){const target=id(ix),h=(ix===400?'e':'f').repeat(64);await db.query(`INSERT INTO eva_automatic_intakes(id,organization_id,customer_id,actor_id,role_id,platform,external,request_id,file_hash,filename,mime,size_bytes,consent,hints,state,stored,lease_token,lease_until) VALUES($1,'org','client',$2,'manager',false,false,$3,$4,'other.pdf','application/pdf',100,true,$5,'RECOGNIZING',true,$6,clock_timestamp()+interval '1 minute')`,[target,actor,id(ix+1),h,JSON.stringify({unitId:id(1),month:'2026-01'}),token]);const dg={...diagnostic,fileHash:h,fingerprint:h,action,fields:diagnostic.fields.map((f,i)=>({...f,status:i<3?'MISMATCH':'MATCH',found:['different']}))};const w=await db.query('SELECT eva_intake_identity_work($1,$2,$3) data',[target,token,JSON.stringify(dg)]);if(action==='REJECT'){ok(w.rows[0].data.rejected);ok((await db.query('SELECT state FROM eva_automatic_intakes WHERE id=$1',[target])).rows[0].state==='DISMISSED');}else{await db.query("UPDATE eva_automatic_intakes SET state='REVIEW_REQUIRED',lease_token=NULL,lease_until=NULL WHERE id=$1",[target]);await deny(()=>db.query("SELECT eva_intake_identity_action('org',$1,'manager',false,'decide',$2,$3)",[actor,target,JSON.stringify({fingerprint:h,decision:'CONTINUE',reason:body.reason})]));const stopped=await db.query("SELECT eva_intake_identity_action('org',$1,'manager',false,'decide',$2,$3) data",[actor,target,JSON.stringify({fingerprint:h,decision:'STOP',reason:'Envio incorreto, preservar o documento e descontinuar.'})]);ok(stopped.rows[0].data.decision==='STOP');}}

await db.exec(`ALTER TABLE document_ocr_jobs ADD COLUMN lease_token uuid,ADD COLUMN lease_until timestamptz,ADD COLUMN submission_started_at timestamptz,ADD COLUMN error_code text,ADD COLUMN next_attempt_at timestamptz,ADD COLUMN updated_at timestamptz;`);
await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261278_eva_preserved_read_completion.sql','utf8'));
const doc=id(600),job=id(601);await db.query(`INSERT INTO documents(id,organization_id,customer_id,consumer_unit_id,document_type,reference_month,file_hash,file_verified) VALUES($1,'org','client',$2,'INVOICE_DISTRIBUTOR','2026-01-01',$3,true)`,[doc,id(1),hash]);
await db.query(`UPDATE eva_automatic_intakes SET document_id=$2,unit_id=$3,month='2026-01',document_type='INVOICE_DISTRIBUTOR',state='WAITING_OCR',proof='{"state":"MATCH"}',raw_result='{"pages":[{"pageNumber":1}]}',operation_url='original-operation',lease_token=$4,lease_until=clock_timestamp()+interval '1 minute' WHERE id=$1`,[intake,doc,id(1),token]);
await db.query(`INSERT INTO document_ocr_jobs(id,organization_id,document_id,file_hash,requested_by,state,error_code,operation_url) VALUES($1,'org',$2,$3,$4,'FAILED','PROVIDER_REJECTED','original-operation')`,[job,doc,hash,actor]);
ok((await db.query('SELECT eva_intake_recover_preserved_ocr($1,$2) result',[intake,token])).rows[0].result===true);
ok((await db.query('SELECT eva_intake_recover_preserved_ocr($1,$2) result',[intake,token])).rows[0].result===false);
await deny(()=>db.query('SELECT eva_intake_preserved_ocr($1,$2)',[job,token]));
await db.query("UPDATE document_ocr_jobs SET lease_token=$2,lease_until=clock_timestamp()+interval '1 minute' WHERE id=$1",[job,token]);
const stored=await db.query('SELECT eva_intake_preserved_ocr($1,$2) data',[job,token]);ok(stored.rows[0].data.intakeId===intake);
await db.query("UPDATE document_ocr_jobs SET file_hash=$2 WHERE id=$1",[job,'0'.repeat(64)]);ok((await db.query('SELECT eva_intake_preserved_ocr($1,$2) data',[job,token])).rows[0].data===null);
const already=await db.query("SELECT eva_intake_identity_action('org',$1,'manager',false,'list',NULL,$2) data",[actor,JSON.stringify({ids:[intake]})]);ok(already.rows[0].data.items.length===0);
await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261279_eva_identity_justification_alias.sql','utf8'));
const reviewIds=await db.query("SELECT id FROM eva_intake_identity_reviews WHERE kind IN('CONTINUE','ADDRESS') AND organization_id='org'");
await db.query('INSERT INTO auth.users VALUES($1,$2,$3)',[actor,JSON.stringify({full_name:'Operador de teste'}),'operator@example.test']);
const comments=await db.query("SELECT eva_intake_identity_action('org',$1,'manager',false,'justifications',NULL,$2) data",[actor,JSON.stringify({refs:reviewIds.rows.map(r=>r.id)})]);
ok(comments.rows[0].data.rows.length===2);ok(comments.rows[0].data.rows.some(r=>r.actor==='Operador de teste'&&r.reason===body.reason));
await deny(()=>db.query("SELECT eva_intake_identity_action('org',$1,'external',false,'justifications',NULL,$2)",[id(70),JSON.stringify({refs:reviewIds.rows.map(r=>r.id)})]));
const foreignComments=await db.query("SELECT eva_intake_identity_action('org',$1,'manager',false,'justifications',NULL,$2) data",[actor,JSON.stringify({refs:[id(999)]})]);ok(foreignComments.rows[0].data.rows.length===0);

await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261296_eva_audited_continue.sql','utf8'));
await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261296_eva_audited_continue.sql','utf8'));
// A confirmed fiscal address belongs to the exact document, not every future unit invoice.
const supplier=id(900);await db.query(`INSERT INTO documents(id,organization_id,customer_id,consumer_unit_id,document_type,reference_month,file_hash,file_verified) VALUES($1,'org','client',$2,'INVOICE_SUPPLIER','2026-01-01',$3,true)`,[supplier,id(1),addressDiag.fileHash]);
await db.query(`UPDATE eva_automatic_intakes SET document_id=$2,unit_id=$3,month='2026-01',proof='{"state":"MATCH"}' WHERE id=$1`,[n,supplier,id(1)]);
const lineage=(org='org',unit=id(1),h=addressDiag.fileHash)=>db.query('SELECT eva_supplier_identity_lineage($1,$2,$3,$4,$5) data',[org,'client',unit,supplier,h]).then(r=>r.rows[0].data);
ok((await lineage()).auditedAddresses[0]==='Rodovia Alternativa, km 55, s/n');ok(await lineage('other')===null);ok(await lineage('org',id(2))===null);ok(await lineage('org',id(1),'f'.repeat(64))===null);
await db.query('UPDATE consumer_units SET address=$1 WHERE id=$2',['Registration changed',id(1)]);ok((await lineage()).auditedAddresses.length===0);await db.query('UPDATE consumer_units SET address=$1 WHERE id=$2',['Rua Exemplo 123',id(1)]);
// An authorized UC decision persists the printed historical identifier for later months.
await db.exec(`UPDATE roles SET permissions=permissions||'["0f2e539d-03f9-4168-bc8c-55ac3a371628"]'::jsonb WHERE id='manager'`);
const continued=id(800),cfp='7'.repeat(64),ch='8'.repeat(64);
await db.query(`INSERT INTO eva_automatic_intakes(id,organization_id,customer_id,actor_id,role_id,platform,external,request_id,file_hash,filename,mime,size_bytes,consent,hints,state,stored,raw_result,lease_token,lease_until) VALUES($1,'org','client',$2,'manager',false,false,$3,$4,'historical.pdf','application/pdf',100,true,$5,'RECOGNIZING',true,'{"content":"Installation 7654322"}',$6,clock_timestamp()+interval '1 minute')`,[continued,actor,id(801),ch,JSON.stringify({unitId:id(1),month:'2026-01'}),token]);
await db.query(`SELECT eva_intake_event($1,'SOURCE_REVIEW',$2,$3)`,[continued,JSON.stringify({customerId:'client',unitId:id(1),month:'2026-01'}),actor]);
const continuedDiag={...diagnostic,fingerprint:cfp,fileHash:ch,unitCode:'7654322',fields:diagnostic.fields.map(f=>f.key==='unit'?{...f,found:['7654322']}:f)};
await db.query('SELECT eva_intake_identity_work($1,$2,$3)',[continued,token,JSON.stringify(continuedDiag)]);await db.query("UPDATE eva_automatic_intakes SET state='REVIEW_REQUIRED',lease_token=NULL,lease_until=NULL WHERE id=$1",[continued]);
const continuedBody=JSON.stringify({...body,fingerprint:cfp});
ok((await db.query("SELECT eva_intake_identity_action('org',$1,'manager',false,'decide',$2,$3) data",[actor,continued,continuedBody])).rows[0].data.decision==='CONTINUE');
ok((await db.query("SELECT count(*)::int n FROM eva_intake_unit_aliases_audit WHERE organization_id='org' AND previous_code='7654322' AND unit_id=$1",[id(1)])).rows[0].n===1);
ok((await db.query("SELECT eva_intake_identity_action('org',$1,'manager',false,'decide',$2,$3) data",[actor,continued,continuedBody])).rows[0].data.replayed);
await db.exec('SET ROLE authenticated');await deny(()=>lineage());await db.exec('RESET ROLE');

await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261299_eva_distributor_address_review.sql','utf8'));
await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261299_eva_distributor_address_review.sql','utf8'));
// An administrator may attest a specific distributor address only after all other anchors match.
for(const [index,unitState] of ['MATCH','MISMATCH','INCONCLUSIVE'].entries()){
 const target=id(1000+index),sourceHash=require('node:crypto').createHash('sha256').update(target).digest('hex');
 await db.query(`INSERT INTO eva_automatic_intakes(id,organization_id,customer_id,actor_id,role_id,platform,external,request_id,file_hash,filename,mime,size_bytes,consent,hints,state,stored,lease_token,lease_until) VALUES($1,'org','client',$2,'manager',false,false,$3,$4,'distributor.pdf','application/pdf',100,true,$5,'RECOGNIZING',true,$6,clock_timestamp()+interval '1 minute')`,[target,actor,id(1100+index),sourceHash,JSON.stringify({unitId:id(1),month:'2026-01'}),token]);
 const dg={...addressDiag,fileHash:sourceHash,fingerprint:sourceHash,documentType:'INVOICE_DISTRIBUTOR',fields:addressDiag.fields.map(f=>f.key==='unit'?{...f,status:unitState}:f)};
 await db.query('SELECT eva_intake_identity_work($1,$2,$3)',[target,token,JSON.stringify(dg)]);await db.query("UPDATE eva_automatic_intakes SET state='REVIEW_REQUIRED',lease_token=NULL,lease_until=NULL WHERE id=$1",[target]);
 const body={fingerprint:sourceHash,decision:'CONTINUE',reason:'Administrator confirmed this exact invoice address for the same physical installation.'};
 const action=(role='admin',a=id(72))=>db.query("SELECT eva_intake_identity_action('org',$1,$2,false,'address',$3,$4) data",[a,role,target,JSON.stringify(body)]);
 await deny(()=>action('manager',actor));
 if(unitState!=='MATCH'){await deny(()=>action());continue;}
 ok((await action()).rows[0].data.decision==='ADDRESS');ok((await action()).rows[0].data.replayed===true);
 await db.query(`INSERT INTO documents(id,organization_id,customer_id,consumer_unit_id,document_type,reference_month,file_hash,file_verified) VALUES($1,'org','client',$2,'INVOICE_DISTRIBUTOR','2026-01-01',$3,true)`,[target,id(1),sourceHash]);
 await db.query(`UPDATE eva_automatic_intakes SET document_id=$1,unit_id=$2,month='2026-01',document_type='INVOICE_DISTRIBUTOR',proof='{"state":"MATCH"}' WHERE id=$1`,[target,id(1)]);
 const lineage=(org='org',unit=id(1),hash=sourceHash)=>db.query('SELECT ocr_identity_native_lineage($1,$2,$3,$4,$5) data',[org,'client',unit,target,hash]).then(r=>r.rows[0].data);
 const l=await lineage();ok(l.auditedAddresses[0]==='Rodovia Alternativa, km 55, s/n'&&l.reviewIds.length===1);ok((await lineage('other')).auditedAddresses.length===0);ok((await lineage('org',id(2))).auditedAddresses.length===0);ok((await lineage('org',id(1),'f'.repeat(64))).auditedAddresses.length===0);
 await db.exec(`CREATE OR REPLACE FUNCTION public.ocr_identity_native_lineage_before_triage(p_org text,p_customer text,p_unit text,p_document text,p_hash text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('codes',jsonb_build_array('1234567'),'editIds','[]'::jsonb,'aliasIds','[]'::jsonb)$$;
 CREATE OR REPLACE FUNCTION public.invoice_identity_registration(text,text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('customerName','Client','taxId','12345678000190','unitNumber','1234567','address','Rua Exemplo 123','month','2026-01')$$;`);
 const proof={version:'invoice-identity-preflight-v1',fileHash:sourceHash,state:'MATCH',registration:{customerName:'Client',taxId:'12345678000190',unitNumber:'1234567',address:'Rua Exemplo 123',month:'2026-01',auditedUnitNumbers:l.codes,auditedAddresses:l.auditedAddresses},registrationReviewIds:l.reviewIds,checks:{unit:'MATCH',taxId:'MATCH',address:'MATCH',period:'MATCH'}};
 const current=p=>db.query('SELECT ocr_identity_proof_current($1,$2,$3) valid',['org',target,JSON.stringify(p)]).then(r=>r.rows[0].valid);
 ok(await current(proof));ok(!await current({...proof,registration:{...proof.registration,auditedAddresses:['Forged street 999']}}));ok(!await current({...proof,registrationReviewIds:[id(999)]}));ok(!await current({...proof,fileHash:'e'.repeat(64)}));

 await db.query('UPDATE consumer_units SET address=$1 WHERE id=$2',['Different registration',id(1)]);ok((await lineage()).auditedAddresses.length===0);await db.query('UPDATE consumer_units SET address=$1 WHERE id=$2',['Rua Exemplo 123',id(1)]);
}

await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261300_eva_restore_original.sql','utf8'));
await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261300_eva_restore_original.sql','utf8'));
const restoreReason={reason:'Operator confirmed this exact original is correct and explicitly requested its restoration.'};
const restore=(target=id(500),org='org',a=actor,role='manager')=>db.query('SELECT eva_intake_restore($1,$2,$3,false,$4,$5) data',[org,a,role,target,JSON.stringify(restoreReason)]);
await deny(()=>restore(id(500),'other'));await deny(()=>restore(id(500),'org',id(70),'external'));await deny(()=>restore(id(400)));await deny(()=>restore(id(800)));
const rawBefore=(await db.query('SELECT raw_result,file_hash FROM eva_automatic_intakes WHERE id=$1',[id(500)])).rows[0];
ok((await restore()).rows[0].data.state==='RECOGNIZING');ok((await restore()).rows[0].data.replayed===true);
ok(JSON.stringify((await db.query('SELECT raw_result,file_hash FROM eva_automatic_intakes WHERE id=$1',[id(500)])).rows[0])===JSON.stringify(rawBefore));
ok((await db.query("SELECT count(*)::int n FROM eva_automatic_intake_events WHERE intake_id=$1 AND event='RESTORED'",[id(500)])).rows[0].n===1);
await db.query("UPDATE eva_automatic_intakes SET state='REVIEW_REQUIRED' WHERE id=$1",[id(500)]);
const restoredReview=(await db.query("SELECT eva_intake_identity_action('org',$1,'manager',false,'list',NULL,$2) data",[actor,JSON.stringify({ids:[id(500)]})])).rows[0].data;
ok(restoredReview.items.length===1);
await db.exec('SET ROLE authenticated');await deny(()=>restore());await db.exec('RESET ROLE');
await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261305_eva_justified_binding_resume.sql','utf8'));
const queuedResume=async(n,kind='UC')=>{
 const target=id(n),fileHash=require('node:crypto').createHash('sha256').update(target).digest('hex');
 await db.query(`INSERT INTO eva_automatic_intakes(id,organization_id,customer_id,actor_id,role_id,platform,external,request_id,file_hash,filename,mime,size_bytes,consent,hints,state,stored) VALUES($1,'org','client',$2,'manager',false,false,$3,$4,'resume.pdf','application/pdf',100,true,'{}','REVIEW_REQUIRED',true)`,[target,actor,id(n+100),fileHash]);
 const binding={customerId:'client',unitId:id(1),month:'2026-01',reason:'Operator explicitly confirmed this original, selected installation and the justified identification difference.'};
 const response=await db.query("SELECT eva_intake_resolve_justified('org',$1,$2,false,$3,$4) data",[kind==='UC'?actor:id(72),kind==='UC'?'manager':'admin',target,JSON.stringify(binding)]);
 ok(response.rows[0].data.continuationRequested===true);
 await db.query("UPDATE eva_automatic_intakes SET lease_token=$2,lease_until=clock_timestamp()+interval '1 minute' WHERE id=$1",[target,token]);
 const dg={...(kind==='UC'?diagnostic:addressDiag),fingerprint:fileHash,fileHash,registration:diagnostic.registration,documentType:kind==='UC'?'INVOICE_DISTRIBUTOR':'INVOICE_SUPPLIER',...(kind==='UC'?{unitCode:'7654399',fields:diagnostic.fields.map(f=>f.key==='unit'?{...f,found:['7654399']}:f)}:{fields:addressDiag.fields.map(f=>f.key==='unit'?{...f,status:'INCONCLUSIVE',found:[]}:f)})};
 await db.query('SELECT eva_intake_identity_work($1,$2,$3)',[target,token,JSON.stringify(dg)]);
 await db.query("UPDATE eva_automatic_intakes SET state='REVIEW_REQUIRED',lease_token=NULL,lease_until=NULL WHERE id=$1",[target]);
 return {target,dg,binding,fileHash};
};
for(const kind of ['UC','ADDRESS']){
 const c=await queuedResume(kind==='UC'?2000:2001,kind);
 ok((await db.query('SELECT eva_intake_continue_requested($1,$2) data',[c.target,c.fileHash])).rows[0].data.continued===true);
 ok((await db.query('SELECT state FROM eva_automatic_intakes WHERE id=$1',[c.target])).rows[0].state==='RECOGNIZING');
 ok((await db.query("SELECT count(*)::int n FROM eva_intake_identity_reviews WHERE intake_id=$1 AND kind=$2",[c.target,kind==='UC'?'CONTINUE':'ADDRESS'])).rows[0].n===1);
 ok((await db.query('SELECT eva_intake_continue_requested($1,$2) data',[c.target,c.fileHash])).rows[0].data.continued===false);
 if(kind==='UC'){
  await db.query("UPDATE eva_automatic_intakes SET lease_token=$2,lease_until=clock_timestamp()+interval '1 minute' WHERE id=$1",[c.target,token]);
  const matched={...c.dg,fingerprint:'7'.repeat(64),action:'REVIEW',unitCode:null,fields:c.dg.fields.map(f=>f.key==='unit'?{...f,status:'MATCH'}:f)};
  const carried=(await db.query('SELECT eva_intake_identity_resume_proof($1,$2,$3) data',[c.target,token,JSON.stringify(matched)])).rows[0].data;
  ok(carried.accepted===true&&carried.unitCode==='7654399');
  const wrong={...matched,fingerprint:'8'.repeat(64),fields:matched.fields.map(f=>f.key==='unit'?{...f,found:['unrelated-code']}:f)};
  ok((await db.query('SELECT eva_intake_identity_resume_proof($1,$2,$3) data',[c.target,token,JSON.stringify(wrong)])).rows[0].data.accepted===false);
 }
}
const staleResume=await queuedResume(2002);
await db.query("UPDATE consumer_units SET address='Changed registration 999' WHERE id=$1",[id(1)]);
ok((await db.query('SELECT eva_intake_continue_requested($1,$2) data',[staleResume.target,staleResume.fileHash])).rows[0].data.continued===false);
await db.query("UPDATE consumer_units SET address='Rua Exemplo 123' WHERE id=$1",[id(1)]);
const revokedIntent=await queuedResume(2003);
await db.query("SELECT eva_intake_action('org',$1,'manager',false,'resolve',$2,$3)",[actor,revokedIntent.target,JSON.stringify(revokedIntent.binding)]);
await db.query("UPDATE eva_automatic_intakes SET state='REVIEW_REQUIRED' WHERE id=$1",[revokedIntent.target]);
ok((await db.query('SELECT eva_intake_continue_requested($1,$2) data',[revokedIntent.target,revokedIntent.fileHash])).rows[0].data.continued===false);
for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await deny(()=>db.query('SELECT eva_intake_continue_requested($1,$2)',[revokedIntent.target,revokedIntent.fileHash]));await db.exec('RESET ROLE');}
await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261309_eva_internal_address_continuation.sql','utf8'));
await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261309_eva_internal_address_continuation.sql','utf8'));
const punctuation=await queuedResume(2100,'ADDRESS');
const repeated={...punctuation.dg,documentType:'INVOICE_DISTRIBUTOR',fields:punctuation.dg.fields.map(f=>f.key==='address'?{...f,status:'INCONCLUSIVE',found:['RDV JOSE FREGONESI SP328 3505','RDV JOSE FREGONESI SP328, 3505']}:f.key==='unit'?{...f,status:'MATCH'}:f)};
await db.query("SELECT eva_intake_resolve_justified('org',$1,'manager',false,$2,$3)",[actor,punctuation.target,JSON.stringify(punctuation.binding)]);
await db.query("UPDATE eva_automatic_intakes SET lease_token=$2,lease_until=clock_timestamp()+interval '1 minute' WHERE id=$1",[punctuation.target,token]);
await db.query('SELECT eva_intake_identity_work($1,$2,$3)',[punctuation.target,token,JSON.stringify(repeated)]);
await db.query("UPDATE eva_automatic_intakes SET state='REVIEW_REQUIRED',lease_token=NULL,lease_until=NULL WHERE id=$1",[punctuation.target]);
ok((await db.query('SELECT eva_intake_continue_requested($1,$2) data',[punctuation.target,punctuation.fileHash])).rows[0].data.continued===true);
ok((await db.query("SELECT actor_id FROM eva_intake_identity_reviews WHERE intake_id=$1 AND kind='ADDRESS'",[punctuation.target])).rows[0].actor_id===actor);
for(const found of [[],['RDV SP328 3505','RDV SP328 3506'],[''],[null]])ok((await db.query('SELECT eva_identity_single_address($1) v',[JSON.stringify(found)])).rows[0].v===false);
await db.exec('SET ROLE authenticated');await deny(()=>db.query('SELECT eva_identity_single_address($1)',[JSON.stringify(['RDV SP328 3505'])]));await db.exec('RESET ROLE');
await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261312_eva_supplier_optional_uc_confirmation.sql','utf8'));
await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261312_eva_supplier_optional_uc_confirmation.sql','utf8'));
const optionalReview=async(n,change=()=>{})=>{
 const c=await queuedResume(n,'ADDRESS'),dg={...c.dg,fingerprint:require('node:crypto').createHash('sha256').update(c.fileHash+'matching-address').digest('hex'),fields:c.dg.fields.map(f=>f.key==='address'?{...f,status:'MATCH',found:[c.dg.registration.address]}:f.key==='unit'?{...f,required:false,found:[]}:f)};change(dg);
 await db.query("UPDATE eva_automatic_intakes SET lease_token=$2,lease_until=clock_timestamp()+interval '1 minute' WHERE id=$1",[c.target,token]);await db.query('SELECT eva_intake_identity_work($1,$2,$3)',[c.target,token,JSON.stringify(dg)]);await db.query("UPDATE eva_automatic_intakes SET state='REVIEW_REQUIRED',lease_token=NULL,lease_until=NULL WHERE id=$1",[c.target]);return {c,dg};
};
const optionalUc=await optionalReview(2200);ok((await db.query('SELECT eva_intake_continue_requested($1,$2) data',[optionalUc.c.target,optionalUc.dg.fingerprint])).rows[0].data.continued===true);
for(const [n,change] of [[2201,d=>{d.documentType='INVOICE_DISTRIBUTOR'}],[2202,d=>{Object.assign(d.fields[2],{status:'MISMATCH',found:['9999999']})}],[2203,d=>{d.fields[0].status='MISMATCH'}],[2204,d=>{d.fields[3].status='MISMATCH'}]]){const x=await optionalReview(n,change);ok((await db.query('SELECT eva_intake_continue_requested($1,$2) data',[x.c.target,x.dg.fingerprint])).rows[0].data.continued===false);}
console.log('Identity SQL checks:',checks);
}finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1});
