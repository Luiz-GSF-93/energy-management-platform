import assert from 'node:assert/strict';
import {aclFixture} from './acl-test-fixture.mjs';
const f=await aclFixture(),{db,actor,peer,client,call,migrate,create,work,evidence,doc}=f;let checks=0;
const check=v=>{assert.ok(v);checks++;},deny=async fn=>{await assert.rejects(fn);checks++;};
try{
 let row=await create();
 const note='Histórico da fatura conferido pelo Consultor com valores e fontes.';
 const submit=async(stage,documents,facts={})=>evidence(row.id,row.revision,'SUBMIT',{stage,documents,facts,kind:'COMPLETE',note});
 await doc('cadastro');row=(await work(row.id,row.revision,'registration','START')).admission;
 let e=await submit('registration',['cadastro']);row=e.admission;row=(await evidence(row.id,row.revision,'APPROVE',{evidence:e.evidenceId,note,actor:peer})).admission;row=(await evidence(row.id,row.revision,'COMPLETE',{evidence:e.evidenceId})).admission;
 await doc('history','INVOICE_DISTRIBUTOR','2026-08-01');await doc('foreign','INVOICE_DISTRIBUTOR','2026-08-01','u2','o2','c2');
 row=(await work(row.id,row.revision,'invoices','START')).admission;
 const rows=Array.from({length:12},(_,i)=>({month:new Date(Date.UTC(2025,8+i,1)).toISOString().slice(0,7),peakKwh:'100.00',offPeakKwh:'1000.00',demandKw:'250.00',days:30,page:2,source:('tables[0].row['+i+'] ').padEnd(180,'x')}));
 const facts={history:{sourceDocumentId:'history',rows}};
 for(const change of [r=>r.rows.pop(),r=>r.rows[1].month=r.rows[0].month,r=>r.rows[0].demandKw='-1',r=>r.rows[0].peakKwh=null,r=>r.rows[0].cost='1000',r=>r.rows[0].days=0,r=>r.rows[0].page=0,r=>r.sourceDocumentId='foreign',r=>r.rows[11].month='2026-09']){const h=structuredClone(facts.history);change(h);await deny(()=>submit('invoices',['history'],{history:h}));}
 await deny(()=>submit('invoices',['foreign'],{history:{...facts.history,sourceDocumentId:'foreign'}}));
 await deny(()=>submit('invoices',['history']));check((await submit('feasibility',['history'],facts)).code==='LOCKED');
 await db.exec("UPDATE documents SET reference_month=NULL WHERE id='history'");await deny(()=>submit('invoices',['history'],facts));await db.exec("UPDATE documents SET reference_month='2026-08-01' WHERE id='history'");
 e=await submit('invoices',['history'],facts);row=e.admission;check(e.ok);
 const read=await call('acl_evidence_read',['o1',actor,'r1',false,row.id,null]);check(read.find(x=>x.id===e.evidenceId).facts.history.rows.length===12);
 await deny(()=>evidence(row.id,row.revision,'APPROVE',{evidence:e.evidenceId,note,actor:client,role:'client'}));
 row=(await evidence(row.id,row.revision,'APPROVE',{evidence:e.evidenceId,note,actor:peer})).admission;
 await db.exec("UPDATE document_catalog SET revision=2 WHERE document_id='history'");await deny(()=>evidence(row.id,row.revision,'COMPLETE',{evidence:e.evidenceId}));await db.exec("UPDATE document_catalog SET revision=1 WHERE document_id='history'");
 row=(await evidence(row.id,row.revision,'COMPLETE',{evidence:e.evidenceId})).admission;check(row.stages.find(x=>x.key==='invoices').status==='COMPLETED');
 check(!JSON.stringify(await call('acl_portal',['o1',client,'client',null])).includes('peakKwh'));
 console.log(JSON.stringify({ok:true,checks}));
}finally{await db.close();}
