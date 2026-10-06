import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const db=new PGlite();
const actor='00000000-0000-4000-8000-000000000001',exclusive='00000000-0000-4000-8000-000000000002',shared='00000000-0000-4000-8000-000000000003',backoffice='00000000-0000-4000-8000-000000000004';
const migration=n=>readFileSync(new URL('../../src/database/migrations/'+n,import.meta.url),'utf8');
let checks=0;
try{
await db.exec("CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;\nCREATE TABLE public.organizations(id text PRIMARY KEY);INSERT INTO public.organizations VALUES('o1'),('o2');\nCREATE TABLE public.customers(id text PRIMARY KEY,organization_id text,company_name text,document text,status text,deleted_at timestamp);INSERT INTO public.customers VALUES('c1','o1','Original','111','ACTIVE',NULL),('c2','o2','Outro','222','ACTIVE',NULL);\nCREATE TABLE public.consumer_units(id text PRIMARY KEY,organization_id text,address text);INSERT INTO public.consumer_units VALUES('u1','o1','Original');\nCREATE TABLE public.roles(id text PRIMARY KEY,organization_id text,name text,scope text,permissions jsonb);\nINSERT INTO public.roles VALUES('admin',NULL,'admin_platform','global','[]'),('consulta','o1','consulta','organization','[]'),('operacional','o1','operacional','organization','[]'),('consulta2','o2','consulta','organization','[]');\nCREATE TABLE public.user_roles(user_id text,role_id text);INSERT INTO public.user_roles VALUES('00000000-0000-4000-8000-000000000001','admin');\nCREATE TABLE public.organization_members(id uuid DEFAULT gen_random_uuid(),organization_id text,user_id uuid,role_id text,status text,affiliation_type text);\nINSERT INTO public.organization_members(organization_id,user_id,role_id,status,affiliation_type) VALUES\n('o1','00000000-0000-4000-8000-000000000002','consulta','active','external'),('o1','00000000-0000-4000-8000-000000000003','consulta','active','external'),('o1','00000000-0000-4000-8000-000000000004','operacional','active','internal'),('o2','00000000-0000-4000-8000-000000000002','consulta2','active','external');\nCREATE TABLE public.audit_logs(id text,organization_id text,user_id uuid,action text,resource_type text,resource_id text,changes jsonb,status text,ip_address text,user_agent text);");
await db.exec(migration('20260924_f1_23_membership_status.sql').replaceAll('ur.user_id=actor_user_id','ur.user_id::text=actor_user_id::text'));
await db.exec(migration('20260927_f1_84_registration_edits.sql'));
await db.exec(migration('20261006_r1_customer_report_contacts.sql'));
const edit=async(changes,version=0,id='c1',request=randomUUID(),org='o1',who=actor)=>(await db.query('SELECT public.edit_registration($1,$2,$3,$4,$5,$6,$7,$8) AS row',[org,'customers',id,who,'Correção de cadastro',version,request,changes])).rows[0].row;
const reject=async(fn,code)=>{await assert.rejects(fn,e=>e.code===code);checks++;};
let r=await edit({company_name:'Corrigido'});assert.equal(r.edit_version,1);checks++;
await reject(()=>edit({company_name:'Stale'}),'40001');
await reject(()=>edit({organization_id:'o2'},1),'22023');
await reject(()=>edit({company_name:'Outra'},0,'c1',randomUUID(),'o2'),'P3840');
await reject(()=>edit({exclusive_user_ids:[backoffice]},1),'42501');
await reject(()=>edit({exclusive_user_ids:[actor]},1),'42501');
r=await edit({exclusive_user_ids:[exclusive]},1);assert.equal(r.edit_version,2);checks++;
const request=randomUUID();r=await edit({status:'INACTIVE'},2,'c1',request);
assert.deepEqual(r.deactivated_user_ids,[exclusive]);assert.equal(r.edit_version,3);checks++;
assert.deepEqual(await edit({status:'INACTIVE'},2,'c1',request),r);checks++;
await reject(()=>edit({company_name:'Reuso'},2,'c1',request),'40001');
const members=(await db.query('SELECT user_id::text,organization_id,status FROM public.organization_members')).rows;
assert.equal(members.find(m=>m.user_id===exclusive&&m.organization_id==='o1').status,'inactive');
assert.equal(members.find(m=>m.user_id===exclusive&&m.organization_id==='o2').status,'active');
assert.equal(members.find(m=>m.user_id===shared).status,'active');assert.equal(members.find(m=>m.user_id===backoffice).status,'active');checks+=4;
r=await edit({status:'ACTIVE'},3);assert.equal((await db.query('SELECT status FROM public.organization_members WHERE user_id=$1 AND organization_id=$2',[exclusive,'o1'])).rows[0].status,'inactive');checks++;
await reject(()=>db.exec("UPDATE public.registration_edits SET reason='forged'"),'23514');
await reject(()=>db.exec('DELETE FROM public.registration_edits'),'23514');
await db.exec("CREATE FUNCTION public.reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable' USING ERRCODE='P9999';END $$;CREATE TRIGGER reject_audit BEFORE INSERT ON public.registration_edits FOR EACH ROW EXECUTE FUNCTION public.reject_audit();UPDATE public.organization_members SET status='active' WHERE user_id='"+exclusive+"' AND organization_id='o1';");
await reject(()=>edit({status:'INACTIVE'},4),'P9999');
assert.equal((await db.query("SELECT status FROM public.customers WHERE id='c1'")).rows[0].status,'ACTIVE');
assert.equal((await db.query('SELECT status FROM public.organization_members WHERE user_id=$1 AND organization_id=$2',[exclusive,'o1'])).rows[0].status,'active');checks+=2;
await db.exec('DROP TRIGGER reject_audit ON public.registration_edits;');
await reject(()=>edit({company_name:'Denied',exclusive_user_ids:[]},4,'c1',randomUUID(),'o1',shared),'42501');
await db.query('SELECT public.edit_registration($1,$2,$3,$4,$5,$6,$7,$8)',['o1','consumer_units','u1',actor,'Corrigir endereço',0,randomUUID(),{address:'Rua correta'}]);assert.equal((await db.query("SELECT address,edit_version FROM public.consumer_units WHERE id='u1'")).rows[0].address,'Rua correta');checks++;

const contact={id:'00000000-0000-4000-8000-000000000010',name:'Contato',department:'Financeiro',email:'contact@example.invalid',phone:'+5516999999999',active:true,channels:['email','sms']};
const valid=async items=>(await db.query('SELECT public.valid_customer_report_contacts($1) AS valid',[items])).rows[0].valid;
assert.equal(await valid([contact]),true);checks++;
for(const input of [null,{},Array(51).fill(contact),[contact,contact],[{...contact,name:''}],[{...contact,channels:['sms'],phone:''}],[{...contact,email:'bad'}],[{...contact,channels:['email','email']}],[{...contact,active:'true'}],[{...contact,organization_id:'o2'}],[{...contact,name:'CR\r\nLF'}]]){assert.equal(await valid(input),false);checks++;}
const creq=randomUUID();const saved=await edit({report_contacts:[contact]},4,'c1',creq);assert.equal(saved.edit_version,5);assert.deepEqual(saved.report_contacts,[contact]);checks++;
assert.deepEqual(await edit({report_contacts:[contact]},4,'c1',creq),saved);checks++;
await reject(()=>edit({report_contacts:[{...contact,name:'Novo'}]},4),'40001');
await reject(()=>edit({report_contacts:[contact]},0,'c2',randomUUID(),'o1'),'P3840');
await reject(()=>edit({report_contacts:[{...contact,channels:['sms'],phone:''}]},5),'22023');
assert.equal((await db.query("SELECT changes->'report_contacts' AS contacts FROM public.registration_edits WHERE request_id=$1",[creq])).rows[0].contacts[0].id,contact.id);checks++;
assert.equal((await db.query("SELECT has_function_privilege('authenticated','public.valid_customer_report_contacts(jsonb)','EXECUTE') AS allowed")).rows[0].allowed,false);checks++;

console.log(JSON.stringify({ok:true,checks}));
}finally{await db.close();}
