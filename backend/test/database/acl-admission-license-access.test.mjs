import {aclFixture} from './acl-test-fixture.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const h=await aclFixture();let checks=0;
const ok=v=>{assert.ok(v);checks++;};const deny=async f=>{await assert.rejects(f,e=>e.code==='42501');checks++;};
try{
 await h.db.exec('ALTER TABLE licenses ADD acl_admissions boolean NOT NULL DEFAULT false');
 const commercial=readFileSync(new URL('../../src/database/migrations/20261010_platform_sales_composition.sql',import.meta.url),'utf8');const start=commercial.indexOf('CREATE OR REPLACE FUNCTION public.validate_platform_sales_extras('),end=commercial.indexOf('$$;',commercial.indexOf('AS $$',start))+3;await h.db.exec(commercial.slice(start,end));
 await h.migrate('20261250_acl_admission_license_access.sql');
 await h.db.query('SELECT validate_platform_sales_extras($1)',[[{code:'acl',module:'acl_admissions',cents:100,recurrence:'MONTHLY'}]]);checks++;

 await deny(()=>h.create());
 await h.db.exec("UPDATE licenses SET acl_admissions=true WHERE organization_id='o1'");
 const created=await h.create();ok(created.organizationId==='o1');
 await deny(()=>h.call('acl_candidates',['o2',h.actor,'r1',false,null]));
 await h.db.exec("UPDATE licenses SET status='SUSPENDED' WHERE organization_id='o1'");await deny(()=>h.call('acl_candidates',['o1',h.actor,'r1',false,null]));
 await h.db.exec("UPDATE licenses SET status='ACTIVE',end_date=CURRENT_DATE-1 WHERE organization_id='o1'");await deny(()=>h.call('acl_candidates',['o1',h.actor,'r1',false,null]));
 await h.db.exec("UPDATE licenses SET end_date=NULL,free_market_management=false WHERE organization_id='o1'");await deny(()=>h.call('acl_candidates',['o1',h.actor,'r1',false,null]));
 await h.db.exec("UPDATE licenses SET free_market_management=true WHERE organization_id='o1'");
 await h.db.query("UPDATE roles SET permissions='[]' WHERE id='r1'");await deny(()=>h.call('acl_candidates',['o1',h.actor,'r1',false,null]));
 await h.db.exec('SET ROLE authenticated');await deny(()=>h.call('acl_candidates',['o1',h.actor,'r1',false,null]));await h.db.exec('RESET ROLE');
 console.log(checks+' ACL server/SQL access checks passed');
}finally{await h.db.close();}
