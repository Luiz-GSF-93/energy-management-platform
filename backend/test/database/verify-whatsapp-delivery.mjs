import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;');
await db.exec(await readFile(new URL('../../src/database/migrations/20261007_whatsapp_delivery.sql',import.meta.url),'utf8'));
for(const role of ['anon','authenticated']){await db.exec(`SET ROLE ${role}`);await assert.rejects(()=>db.query('SELECT * FROM platform_whatsapp_status_events'),e=>e.code==='42501');await assert.rejects(()=>db.query("INSERT INTO platform_whatsapp_status_events VALUES('a','wamid.a','delivered',now(),'[]',now())"),e=>e.code==='42501');await db.exec('RESET ROLE');}
await db.exec('SET ROLE service_role');
for(let i=0;i<2;i++)await db.exec("INSERT INTO platform_whatsapp_status_events(event_key,message_id,status,event_at) VALUES('a','wamid.a','delivered',now()) ON CONFLICT(event_key) DO NOTHING");
assert.equal((await db.query('SELECT count(*)::integer n FROM platform_whatsapp_status_events')).rows[0].n,1);
await assert.rejects(()=>db.exec("INSERT INTO platform_whatsapp_status_events(event_key,message_id,status,event_at) VALUES('b','wamid.b','accepted',now())"),e=>e.code==='23514');
console.log('6 SQL checks passed: direct reads/writes denied, duplicate callbacks deduplicated, unconfirmed status rejected.');await db.close();
