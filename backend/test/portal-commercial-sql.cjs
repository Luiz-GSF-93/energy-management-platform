/* Isolated PostgreSQL test; synthetic identities never reach production. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require(process.env.PGLITE_TEST_MODULE||'@electric-sql/pglite');
const root=path.join(__dirname,'../src/database/migrations');
const read=n=>fs.readFileSync(path.join(root,n),'utf8');
function fn(sql,name){const match=sql.match(new RegExp('CREATE(?: OR REPLACE)? FUNCTION public\\.'+name+'\\([\\s\\S]*?AS \\$\\$[\\s\\S]*?\\$\\$;'));assert(match,name);return match[0];}
const actor='11111111-1111-4111-8111-111111111111',manager='22222222-2222-4222-8222-222222222222',customerActor='33333333-3333-4333-8333-333333333333';
let checks=0;
(async()=>{
const db=new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE organizations(id text PRIMARY KEY,deleted_at timestamptz);
CREATE TABLE roles(id text PRIMARY KEY,organization_id text,name text,scope text,permissions jsonb);
CREATE TABLE user_roles(user_id uuid,role_id text);
CREATE TABLE user_profiles(user_id uuid,name text);
CREATE TABLE organization_members(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text,user_id uuid,role_id text,status text,affiliation_type text,exclusive_customer_id text,display_name text);
CREATE TABLE platform_organization_sessions(organization_id text,user_id uuid,revoked_at timestamptz,expires_at timestamptz);
CREATE TABLE customers(id text PRIMARY KEY,organization_id text,status text,deleted_at timestamptz);
CREATE TABLE consumer_units(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text,customer_id text,deleted_at timestamptz);
CREATE TABLE documents(organization_id text);
CREATE TABLE audit_logs(id text,organization_id text,user_id uuid,action text,resource_type text,resource_id text,changes jsonb,status text,ip_address text,user_agent text);
CREATE TABLE plan_catalog(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,description text,active boolean,version int DEFAULT 1,documents_limit int,documents_unlimited boolean DEFAULT false,max_consumer_units int,max_users int,document_management boolean,advanced_analytics boolean,report_generation boolean,free_market_management boolean,bot_energy_rag boolean DEFAULT false,trading_hub boolean DEFAULT false,ccee_registrations boolean DEFAULT false,ai_monthly_limit_micro_usd bigint DEFAULT 0,monthly_price_brl_cents bigint DEFAULT 0,max_clients int,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE TABLE platform_plan_audit(id uuid DEFAULT gen_random_uuid(),plan_id uuid,actor_id uuid,action text,changes jsonb,ip_address text,user_agent text);
CREATE TABLE licenses(id text PRIMARY KEY,organization_id text,license_type text,documents_limit int,documents_used int,documents_unlimited boolean DEFAULT false,renewal_date date,start_date date,end_date date,status text,active boolean,max_consumer_units int,max_users int,document_management boolean,advanced_analytics boolean,report_generation boolean,free_market_management boolean,bot_energy_rag boolean DEFAULT false,trading_hub boolean DEFAULT false,ccee_registrations boolean DEFAULT false,ai_monthly_limit_micro_usd bigint DEFAULT 0,monthly_price_brl_cents bigint DEFAULT 0,plan_id uuid,plan_version int,plan_snapshot jsonb,governance_revision int DEFAULT 1,updated_at timestamptz DEFAULT now());
INSERT INTO organizations VALUES('org',null),('foreign',null);
INSERT INTO roles VALUES('platform',null,'admin_platform','global','["af285642-16b0-405a-982c-58de1a10f987"]'),('manager','org','gestor','organization','["94f57d38-0438-43c5-81bc-5544ab53912a","8c5673e4-115c-4ab7-bb11-3b410eddcad3"]'),('client','org','consulta','organization','[]'),('foreign-manager','foreign','admin_org','organization','["94f57d38-0438-43c5-81bc-5544ab53912a","8c5673e4-115c-4ab7-bb11-3b410eddcad3"]');
INSERT INTO user_roles VALUES('${actor}','platform');
INSERT INTO organization_members(organization_id,user_id,role_id,status,affiliation_type,display_name) VALUES('org','${manager}','manager','active','internal','Maria Gestora');
INSERT INTO user_profiles VALUES('${manager}','Maria Gestora'),('${actor}','Admin');
INSERT INTO customers VALUES('customer','org','ACTIVE',null),('other','foreign','ACTIVE',null);
`);
const governance=read('20260925_f1_39_license_governance.sql');
await db.exec(fn(read('20260924_f1_15_plan_catalog.sql'),'save_catalog_plan').replace('public.save_catalog_plan(', 'public.save_catalog_plan_v15('));
for(const name of ['assert_license_platform_actor','organization_resource_usage','save_catalog_plan','enforce_organization_capacity'])await db.exec(fn(governance,name));
for(const [file,before] of [['20261005_f6_bot_energy_plan_costs.sql','save_catalog_plan_before_ai'],['20261005_f7_1_trading_hub.sql','save_catalog_plan_before_trading'],['20261008_ccee_registration_plan.sql','save_catalog_plan_before_ccee'],['20261009_client_portal_licenses.sql','save_catalog_plan_before_clients']]){
 await db.exec(`ALTER FUNCTION public.save_catalog_plan(uuid,integer,jsonb,uuid,text,text) RENAME TO ${before};`);
 await db.exec(fn(read(file),'save_catalog_plan'));
}
const old=read('20261009_client_portal_licenses.sql');
for(const name of ['client_portal_policies','client_portal_licenses','license_client_additions','client_portal_license_events']){
 const match=old.match(new RegExp('CREATE TABLE public\\.'+name+' \\([\\s\\S]*?\\n\\);'));assert(match,name);await db.exec(match[0]);
}
await db.exec(fn(old,'snapshot_portal_actor'));
await db.exec('CREATE TRIGGER snapshot_portal_actor BEFORE INSERT ON client_portal_license_events FOR EACH ROW EXECUTE FUNCTION snapshot_portal_actor();');
await db.exec(read('20261010_portal_plan_module.sql'));
await db.exec(`CREATE TRIGGER shared_capacity BEFORE INSERT OR UPDATE ON organization_members FOR EACH ROW EXECUTE FUNCTION enforce_organization_capacity(); CREATE TRIGGER child_capacity BEFORE INSERT OR UPDATE ON organization_members FOR EACH ROW EXECUTE FUNCTION enforce_client_portal_resource_capacity();`);
async function denied(sql,params,code='42501'){try{await db.query(sql,params);assert.fail('Expected rejection');}catch(e){assert.equal(e.code,code);}checks++;}
const planDefinition={name:'Test Portal',description:'Synthetic',active:true,documents_limit:10,documents_unlimited:false,max_consumer_units:5,max_users:3,document_management:true,advanced_analytics:true,report_generation:true,free_market_management:true,bot_energy_rag:true,trading_hub:true,ccee_registrations:false,ai_monthly_limit_micro_usd:100,monthly_price_brl_cents:100,client_portal:true};
const saved=(await db.query('SELECT save_catalog_plan(null,0,$1,$2,null,null) data',[JSON.stringify(planDefinition),actor])).rows[0].data;
assert.equal(saved.client_portal,true);checks++;
const planAudit=(await db.query('SELECT changes FROM platform_plan_audit WHERE plan_id=$1',[saved.id])).rows[0].changes;
assert.equal(planAudit.after.client_portal,true);checks++;
await denied('SELECT save_catalog_plan(null,0,$1,$2,null,null)',[JSON.stringify(planDefinition),manager]);
const parent=(await db.query("SELECT save_plan_license('org',null,0,$1,$2,CURRENT_DATE-30,CURRENT_DATE+365,CURRENT_DATE+365,'ACTIVE',null,$3,null,null) data",[saved.id,saved.version,actor])).rows[0].data;
assert.equal(parent.client_portal,true);checks++;
assert.equal(parent.max_users,3);checks++;
const child={revision:0,status:'ACTIVE',starts:parent.start_date,ends:parent.end_date,modules:['reports','forecasts','bot','agenda','notifications','map','trading'],maxUsers:2,maxUnits:2,reason:'Authorized synthetic test'};
await denied('SELECT save_client_portal_license($1,$2,$3,$4)',['foreign','other',manager,JSON.stringify(child)]);
await denied('SELECT save_client_portal_license($1,$2,$3,$4)',['org','other',manager,JSON.stringify(child)]);
await denied('SELECT save_client_portal_license($1,$2,$3,$4)',['org','customer',actor,JSON.stringify(child)]);
const childSaved=(await db.query('SELECT save_client_portal_license($1,$2,$3,$4) data',['org','customer',manager,JSON.stringify(child)])).rows[0].data;
assert.equal(childSaved.organization_id,'org');checks++;
const event=(await db.query("SELECT * FROM client_portal_license_events WHERE kind='PORTAL_LICENSE'")).rows[0];
assert.equal(event.actor_name,'Maria Gestora');assert.equal(event.actor_role,'gestor');assert.equal(event.actor_affiliation,'internal');checks+=3;
await denied('SELECT save_client_portal_license($1,$2,$3,$4)',['org','customer',manager,JSON.stringify(child)],'P3413');
await db.exec(`INSERT INTO organization_members(organization_id,user_id,role_id,status,affiliation_type,exclusive_customer_id) VALUES('org','${customerActor}','client','active','external','customer');`);
const entitlement=(await db.query("SELECT client_portal_entitlement('org',$1,'client','reports') data",[customerActor])).rows[0].data;
assert.equal(entitlement.customerId,'customer');checks++;
await denied("SELECT client_portal_entitlement('foreign',$1,'client','reports')",[customerActor]);
await denied("SELECT client_portal_entitlement('org',$1,'manager','reports')",[customerActor]);
let capacity=(await db.query("SELECT client_capacity('org') data")).rows[0].data;
assert.equal(capacity.portalContracted,true);assert.equal(capacity.used,2);assert.equal(capacity.available,1);checks+=3;
await db.exec("INSERT INTO organization_members(organization_id,user_id,role_id,status,affiliation_type,exclusive_customer_id) VALUES('org',gen_random_uuid(),'client','active','external','customer');");
await denied("INSERT INTO organization_members(organization_id,user_id,role_id,status,affiliation_type,exclusive_customer_id) VALUES('org',gen_random_uuid(),'client','active','external','customer')",[],'P3411');
await db.exec(`UPDATE organization_members SET status='inactive' WHERE user_id='${customerActor}';`);
capacity=(await db.query("SELECT client_capacity('org') data")).rows[0].data;assert.equal(capacity.available,1);checks++;
await denied("SELECT client_portal_entitlement('org',$1,'client','reports')",[customerActor]);
await db.exec("UPDATE licenses SET client_portal=false WHERE organization_id='org';");
await denied("SELECT client_portal_parent_license('org')",[]);
await db.exec("UPDATE licenses SET client_portal=true,end_date=CURRENT_DATE-1 WHERE organization_id='org';");
await denied("SELECT client_portal_parent_license('org')",[]);
for(const role of ['anon','authenticated']){const r=await db.query("SELECT has_function_privilege($1,'public.save_client_portal_license(text,text,uuid,jsonb)','EXECUTE') allowed",[role]);assert.equal(r.rows[0].allowed,false);checks++;}
await db.close();console.log('PASS isolated PostgreSQL commercial Portal:',checks,'checks');
})().catch(e=>{console.error(e);process.exitCode=1});
