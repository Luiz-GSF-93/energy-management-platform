module.exports=async({db,id,ok,deny,jobs})=>{
 const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
 const {prepareComposite}=require('../dist/modules/ocr/eva-composite.model');
 const preserved=async()=>({versions:(await db.query('SELECT count(*) n FROM eva_official_extraction_versions')).rows[0].n,releases:(await db.query('SELECT count(*) n FROM eva_composite_releases')).rows[0].n,sections:(await db.query('SELECT count(*) n FROM eva_official_extraction_sections')).rows[0].n});
 const before=await preserved();ok((await db.query('SELECT count(*) n FROM eva_curation_page_manifests')).rows[0].n===0);assert.deepEqual(await preserved(),before);ok(true);
 for(const t of ['eva_curation_page_manifests','eva_curation_exclusions']){const r=(await db.query('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass',[t])).rows[0];ok(r.relrowsecurity&&r.relforcerowsecurity);for(const role of ['anon','authenticated','service_role'])for(const perm of ['SELECT','INSERT','UPDATE','DELETE'])ok(!(await db.query('SELECT has_table_privilege($1,$2,$3) p',[role,t,perm])).rows[0].p);}
 for(const role of ['anon','authenticated'])ok(!(await db.query("SELECT has_function_privilege($1,'eva_page_curation_action(uuid,text,uuid,jsonb)','EXECUTE') p",[role])).rows[0].p);
 for(const role of ['anon','authenticated','service_role'])ok(!(await db.query("SELECT has_function_privilege($1,'eva_curation_coverage_complete(uuid)','EXECUTE') p",[role])).rows[0].p);
 const rpc=(actor,action,job,body)=>db.query('SELECT eva_page_curation_action($1,$2,$3,$4) data',[actor,action,job,JSON.stringify(body)]).then(r=>r.rows[0].data);
 const x=(actor,action,job,body)=>db.query('SELECT eva_official_extraction_action($1,$2,$3,$4) data',[actor,action,job,JSON.stringify(body)]).then(r=>r.rows[0].data);
 const detail=job=>x(id(1),'detail',job,{page:0,sectionPage:0});let seq=92000;const next=()=>id(seq++);
 const why='Explicit synthetic page curation evidence in disposable PostgreSQL.';
 const decision=d=>({requestId:next(),justification:why,expectedVersionId:d.versionId,expectedCurationEventId:d.curationEventId,expectedContentHash:d.contentHash});
 const exclusion={reason:'Synthetic editorial historical wording; not normative evidence.',reference:'Original preserved PDF and compiled authority fixture.',anchor:'After the last normative row; private historical source retained.'};
 const input=(d)=>({...decision(d),metadata:{publishedOn:'2026-01-01',validFrom:'2026-01-01',validTo:null,topic:'Synthetic part',references:['https://www.gov.br/aneel/pt-br/test.pdf']},pages:Array.from({length:d.pageCount},(_,i)=>({page:i+1,state:i===1?'EXCLUDED':i===2?'MIXED':'INCLUDED',segments:i===1?[]:[{heading:'Article and original page checked',text:'Art. '+(i+1)+' Reviewed normative fixture only.'}],exclusion:i===1||i===2?exclusion:null}))});
 let d=await detail(jobs[0].id),body=input(d);
 await deny(()=>rpc(null,'detail',d.id,{page:0}),'42501');await deny(()=>rpc(id(2),'detail',d.id,{page:0}),'42501');await deny(()=>rpc(id(1),'detail',d.id,{page:0,organizationId:'other'}),'22023');
 const originalVersions=await preserved();
 for(const kind of ['gap','duplicate','extra','missingEvidence','wrongDisposition','empty','metadata','parent','source','oversized','array']){
  const b=JSON.parse(JSON.stringify(body));b.requestId=next();if(kind==='gap')b.pages.pop();if(kind==='duplicate')b.pages[1].page=1;if(kind==='extra')b.organizationId='other';if(kind==='missingEvidence')b.pages[1].exclusion=null;if(kind==='wrongDisposition')b.pages[1].segments=[{heading:'',text:'Forbidden fake filler'}];if(kind==='empty')b.pages[0].segments=[];if(kind==='metadata')b.metadata.references=['https://evil.invalid/source'];if(kind==='parent')b.expectedVersionId=next();if(kind==='source')b.expectedContentHash='0'.repeat(64);if(kind==='oversized')b.pages[0].segments[0].text='x'.repeat(6001);if(kind==='array')b.pages={};
  await deny(()=>rpc(id(1),'prepare',d.id,b),['parent','source'].includes(kind)?'23505':'22023');assert.deepEqual(await preserved(),originalVersions);ok(true);
 }
 const created=await rpc(id(1),'prepare',d.id,body);ok(created.state==='DRAFT'&&created.pages===40&&created.sections===39&&!created.published);ok((await rpc(id(1),'prepare',d.id,body)).replayed);
 await deny(()=>rpc(id(3),'prepare',d.id,body),'23505');await deny(()=>rpc(id(1),'prepare',jobs[1].id,body),'23505');
 d=await detail(d.id);let manifest=await rpc(id(1),'detail',d.id,{page:0});ok(manifest.coveredPages===40&&manifest.rows[1].disposition==='EXCLUDED'&&manifest.rows[1].segments===0&&manifest.rows[2].disposition==='MIXED'&&manifest.complete);
 ok((await rpc(id(1),'detail',d.id,{page:3})).rows.length===10);ok((await rpc(id(1),'detail',d.id,{page:4})).rows.length===0);
 ok(!(await db.query("SELECT EXISTS(SELECT 1 FROM eva_official_extraction_sections WHERE version_id=$1 AND page=2) p",[d.versionId])).rows[0].p);
 await deny(()=>x(id(1),'correct',d.id,{...decision(d),patches:[],metadata:body.metadata,contentHash:'b'.repeat(64)}),'23505');
 await deny(()=>x(id(1),'review',d.id,{...decision(d),acknowledgedPages:Array.from({length:40},(_,i)=>i+1)}),'42501');
 await x(id(3),'review',d.id,{...decision(d),acknowledgedPages:Array.from({length:40},(_,i)=>i+1)});ok((await detail(d.id)).curation==='REVIEWED');
 await db.query('UPDATE platform_team_members SET active=false WHERE user_id=$1',[id(1)]);await deny(()=>rpc(id(1),'detail',d.id,{page:0}),'42501');ok(!(await rpc(id(3),'detail',d.id,{page:0})).complete);await db.query('UPDATE platform_team_members SET active=true WHERE user_id=$1',[id(1)]);
 // Changing a reviewed page creates a fresh DRAFT; it cannot retain review.
 d=await detail(d.id);const changed=input(d);changed.pages[0].segments[0].text+=' Changed clause, independent review required.';await rpc(id(1),'prepare',d.id,changed);d=await detail(d.id);ok(d.curation==='DRAFT');ok((await rpc(id(1),'detail',d.id,{page:0,requestId:body.requestId})).request.versionId===created.versionId);ok((await rpc(id(1),'detail',jobs[1].id,{page:0,requestId:body.requestId})).request===null);await deny(()=>rpc(id(1),'detail',d.id,{page:0,requestId:'invalid'}),'22023');
 const raceBody=input(d);const race=await Promise.allSettled([rpc(id(1),'prepare',d.id,raceBody),rpc(id(1),'prepare',d.id,{...raceBody,requestId:next()})]);ok(race.filter(r=>r.status==='fulfilled').length===1);ok(race.filter(r=>r.status==='rejected'&&r.reason.code==='23505').length===1);
 // Use exactly two Owners for preparation and independent decisions. A second
 // review by the same independent reviewer is not a third-Owner requirement.
 const pc=(actor,action,set,b)=>db.query('SELECT eva_document_parts_action($1,$2,$3,$4) data',[actor,action,set,JSON.stringify(b)]).then(r=>r.rows[0].data);
 let set=(await db.query('SELECT id FROM eva_official_document_part_sets ORDER BY created_at DESC,revision DESC LIMIT 1')).rows[0];set=await pc(id(1),'detail',set.id,{page:0});
 for(const [i,job] of jobs.entries()){
  d=await detail(job.id);if(i!==0){await rpc(id(1),'prepare',d.id,input(d));d=await detail(job.id);}
  await x(id(3),'review',d.id,{...decision(d),acknowledgedPages:Array.from({length:d.pageCount},(_,i)=>i+1)});d=await detail(job.id);
  const linked=await pc(id(1),'link',set.id,{requestId:next(),expectedSetId:set.id,justification:why,ordinal:i+1,jobId:d.id,expectedVersionId:d.versionId,expectedContentHash:d.contentHash});set=await pc(id(1),'detail',linked.id,{page:0});
 }
 await deny(()=>pc(id(1),'review',set.id,{requestId:next(),expectedSetId:set.id,justification:why}),'42501');
 const reviewed=await pc(id(3),'review',set.id,{requestId:next(),expectedSetId:set.id,justification:why});ok(reviewed.state==='REVIEWED_PRIVATE');
 const cr=(actor,action,key,b)=>db.query('SELECT eva_composite_action($1,$2,$3,$4) data',[actor,action,key,JSON.stringify(b)]).then(r=>r.rows[0].data);
 const source=await cr(id(1),'candidate',reviewed.id,{});ok(source.parts.every(p=>p.coverage.length===p.pageCount));const plan=prepareComposite(source);ok(plan.manifest.chunkTotal===98&&!plan.batches.flatMap(b=>b.chunks).some(c=>[2,42,82].includes(c.page)));ok(plan.manifest.parts[0].coverage[1].state==='EXCLUDED');
 const release=await cr(id(1),'prepare',null,{requestId:next(),setId:source.setId,expectedManifestHash:source.manifestHash,justification:why,...plan});ok(release.state==='DRAFT'&&!release.published);
 const forged=JSON.parse(JSON.stringify(plan));forged.manifest.parts[0].coverage[1].state='INCLUDED';await deny(()=>cr(id(1),'prepare',null,{requestId:next(),setId:source.setId,expectedManifestHash:source.manifestHash,justification:why,...forged}),'23505');
 await db.query('UPDATE platform_team_members SET active=false WHERE user_id=$1',[id(1)]);await deny(()=>cr(id(3),'candidate',reviewed.id,{}),'23505');await db.query('UPDATE platform_team_members SET active=true WHERE user_id=$1',[id(1)]);
 d=await detail(jobs[0].id);await rpc(id(3),'prepare',d.id,input(d));d=await detail(d.id);await deny(()=>x(id(1),'review',d.id,{...decision(d),acknowledgedPages:Array.from({length:d.pageCount},(_,i)=>i+1)}),'42501');await deny(()=>x(id(3),'review',d.id,{...decision(d),acknowledgedPages:Array.from({length:d.pageCount},(_,i)=>i+1)}),'42501');
 for(const t of ['eva_curation_page_manifests','eva_curation_exclusions']){await deny(()=>db.query('DELETE FROM '+t),'42501');await deny(()=>db.query('UPDATE '+t+' SET page=page'),'42501');}
 console.log('PAGE_CURATION_COVERAGE_AND_TWO_OWNER_SQL_PASS');
};
