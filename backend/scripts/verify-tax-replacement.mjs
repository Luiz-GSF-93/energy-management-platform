import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
CREATE TABLE calculation_parameters(id uuid PRIMARY KEY,organization_id text,customer_id text,consumer_unit_id text,kind text,component_code text,scenario text,start_date date,end_date date,treatment text,measure text,amount_text text,time_band text,direction text,source text,status text,revision integer,tax_basis jsonb,embedded_tax_codes jsonb,supersedes_parameter_id uuid,updated_by text,retirement_reason text);`);
await db.exec(readFileSync(process.argv[2],'utf8'));
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const src='OCR fatura · documento '+uuid(100)+' · SHA-256 '+'a'.repeat(64);
const common={organization_id:'org',customer_id:'customer',consumer_unit_id:'unit',kind:'TARIFF',scenario:'ACL',start_date:'2026-08-01',end_date:'2026-08-31',treatment:'GROSS',measure:'BRL_MWH',amount_text:'10',direction:'DEBIT',status:'APPROVED',revision:1,embedded_tax_codes:['ICMS','PIS','COFINS']};
async function insert(r){let keys=Object.keys(r);await db.query('INSERT INTO calculation_parameters('+keys.join(',')+') VALUES('+keys.map((_,i)=>'$'+(i+1)).join(',')+')',Object.values(r).map(v=>v!==null&&typeof v==='object'?JSON.stringify(v):v));}
const item=n=>({parameterId:uuid(n),revision:1,operation:'INCLUDE'});
async function reset(label='fatura',type='CDE'){
 await db.exec('TRUNCATE calculation_parameters');
 for(let n=1;n<=4;n++)await insert({...common,id:uuid(n),component_code:n<=2?'TUSD_ENERGY':type==='CDE'?'CDE_WATER_SCARCITY':n===3?'TUSD_DEMAND_USED':'TUSD_DEMAND_UNUSED',time_band:n<=2||type==='CDE'?(n%2?'PEAK':'OFF_PEAK'):'ALL',measure:n<=2||type==='CDE'?'BRL_MWH':'BRL_KW',source:src.replace('fatura',label)+' · tables[3].row['+n+']'});
 await insert({...common,id:uuid(10),kind:'TAX',component_code:'PIS',measure:'PERCENT',amount_text:null,time_band:'ALL',treatment:'INCLUDED',source:src.replace('fatura',label),tax_basis:{version:1,items:[item(1),item(2)]}});
 await insert({...common,id:uuid(11),kind:'TAX',component_code:'PIS',measure:'PERCENT',amount_text:null,time_band:'ALL',treatment:'INCLUDED',status:'DRAFT',source:src.replace('fatura','CPFL')+' · versão ampliada do parâmetro '+uuid(10),supersedes_parameter_id:uuid(10),tax_basis:{version:1,items:[1,2,3,4].map(item)}});
}
const approve=(org='org',rev=1)=>db.query('SELECT approve_parameter_replacement($1,$2,$3,$4) AS result',[org,uuid(11),rev,'actor']);
for(const label of ['fatura','CPFL']){await reset(label);assert.equal((await approve()).rows[0].result.status,'APPROVED');assert.equal((await approve()).rows[0].result.status,'APPROVED');}
await reset('fatura','DEMAND');assert.equal((await approve()).rows[0].result.status,'APPROVED');
for(const change of [`UPDATE calculation_parameters SET source=replace(source,repeat('a',64),repeat('b',64)) WHERE id='${uuid(11)}'`,`UPDATE calculation_parameters SET revision=2 WHERE id='${uuid(3)}'`,`UPDATE calculation_parameters SET organization_id='other' WHERE id='${uuid(3)}'`,`UPDATE calculation_parameters SET source=replace(source,repeat('a',64),repeat('b',64)) WHERE id='${uuid(3)}'`,`UPDATE calculation_parameters SET status='RETIRED' WHERE id='${uuid(3)}'`,`UPDATE calculation_parameters SET tax_basis=jsonb_set(tax_basis,'{items,2,operation}','"EXCLUDE"') WHERE id='${uuid(11)}'`]){
 await reset();await db.exec(change);await assert.rejects(()=>approve());assert.equal((await db.query('SELECT status FROM calculation_parameters WHERE id=$1',[uuid(10)])).rows[0].status,'APPROVED');
}
await reset();await assert.rejects(()=>approve('other'));await assert.rejects(()=>approve('org',2));
assert.equal((await db.query(`SELECT has_function_privilege('authenticated','approve_parameter_replacement(text,uuid,integer,text)','EXECUTE') AS allowed`)).rows[0].allowed,false);
console.log('PASS: legacy/generic CPFL CDE and Elektro demand; idempotency; cross-tenant/source, stale revision, retired base and invalid exclusions rejected; failed approval preserves predecessor; browser role denied. Isolated schema; other production guards not simulated.');await db.close();
