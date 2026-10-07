import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE TABLE roles(id text,scope text,permissions jsonb);CREATE TABLE user_roles(user_id text,role_id text);INSERT INTO roles VALUES('00000000-0000-0000-0000-000000000001','global','["ede45b9c-8af4-4b47-8490-9d386a3efb13"]'),('00000000-0000-0000-0000-000000000002','organization','["ede45b9c-8af4-4b47-8490-9d386a3efb13"]');INSERT INTO user_roles VALUES('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000002');`);
await db.exec(await readFile(new URL('../../src/database/migrations/20261007_whatsapp_renewal.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../../src/database/migrations/20261007_whatsapp_renewal_actor_text.sql',import.meta.url),'utf8'));
const base={revision:1,issued_on:'2026-10-07',expires_on:'2026-12-06',no_expiry:false,reminder_days:15};
const save=(b,actor='00000000-0000-0000-0000-000000000003')=>db.query('SELECT save_platform_whatsapp_renewal($1::jsonb,$2::uuid) value',[JSON.stringify(b),actor]);
await assert.rejects(()=>save(base,'00000000-0000-0000-0000-000000000004'),e=>e.code==='42501');
await assert.rejects(()=>save({...base,token:'not-allowed'}),e=>e.code==='22023');
await assert.rejects(()=>save({...base,no_expiry:true}),e=>e.code==='23514');
const result=await save(base);assert.equal(result.rows[0].value.revision,2);
await assert.rejects(()=>save(base),e=>e.code==='P3151');
assert.equal((await db.query('SELECT count(*)::integer n FROM platform_whatsapp_renewal_audit')).rows[0].n,1);
for(const role of ['anon','authenticated']){await db.exec(`SET ROLE ${role}`);await assert.rejects(()=>db.query('SELECT * FROM platform_whatsapp_renewal'),e=>e.code==='42501');await assert.rejects(()=>save(base),e=>e.code==='42501');await db.exec('RESET ROLE');}
console.log('10 checks passed: role isolation, metadata-only, date consistency, optimistic revision, atomic audit, direct access denied.');await db.close();
