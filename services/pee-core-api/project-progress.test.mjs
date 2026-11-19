import test from 'node:test';
import assert from 'node:assert/strict';
import {assessProject} from './evaluation.mjs';
import {integratedProgress} from './project-progress.mjs';
import {validateSimulation} from './project-policy.mjs';
import {opportunityInputs} from './engineering.mjs';
import {renderProjectProgress} from './web/workspace-progress.mjs';
const fixture=()=>({project:{id:'p',version:4,phase:'Elaboração',economics:{energy_cost:700,demand_cost:0,discount_rate:0},sections:{}},company:{id:'c',cnpj:'00.000.000/0001-91'},unit:{id:'u',company_id:'c'},simulations:[],documents:[],fingerprint:'technical-one',snapshot_hash:'full-one',rule:{id:'r',version:2,reviewed:true,edition:'2',source_url:'https://www.gov.br/aneel',distributor:'CPFL',rcb_basis:'total',max_rcb:1,requirements:[]}});
const progress=d=>integratedProgress(d,assessProject(d),{now:new Date('2026-11-19T12:00:00Z')});
test('module counters partition the real engine checks and preserve evidence provenance',()=>{
 const d=fixture(),a=assessProject(d),p=progress(d),expected=a.qualification.checks.filter(c=>c.required&&c.state!=='not_applicable');
 assert.deepEqual(p.modules.flatMap(m=>m.check_ids).sort(),expected.map(c=>c.id).sort());
 assert.equal(p.modules.reduce((n,m)=>n+m.total,0),expected.length);
 assert.equal(p.technical_hash,d.fingerprint);assert.equal(p.snapshot_hash,d.snapshot_hash);assert.equal(p.rule_version,2);assert.equal(p.project_version,4);
 assert.equal(p.competition.approval_probability,null);assert.equal(p.submission.ready_for_review,false);
 assert.deepEqual(p.submission.blocking_issues,a.issues);
});
test('selected simulation changes flow into economic qualification and explicit blockers',()=>{
 const d=fixture(),s={...validateSimulation({name:'LED',project_id:'p',type:'IL',boundary:'Warehouse',maker:'Fixture',model:'Fixture',inputs:Object.fromEntries(opportunityInputs.IL.map(([k,l,v])=>[k,v])),cost:100000,life:10,selected:true}),id:'s'};
 d.simulations=[s];assert.equal(progress(d).modules.find(m=>m.id==='economics').blockers,0);
 d.simulations=[{...s,cost:10000000}];d.fingerprint='technical-two';
 const p=progress(d);assert.equal(p.modules.find(m=>m.id==='economics').blockers,1);
 assert(p.next_actions.some(a=>a.check_id==='rcb'&&a.priority==='Crítica'&&a.target==='economics'));
 d.simulations=[{...s,selected:false}];assert.equal(progress(d).modules.find(m=>m.id==='diagnosis').missing,1);
});
test('technical updates invalidate cross-module reviews; assignments do not manufacture completion',()=>{
 const d=fixture();d.project.sections.objective='Detailed objective';d.project.reviewed_domains={technical:{input_hash:d.fingerprint}};
 const before=progress(d);d.fingerprint='technical-changed';d.project.responsibility={project_owner_user_name:'Coordenação sintética'};
 d.project.action_assignments={typology:{responsible:'Responsável do cadastro',due_on:'2026-12-01'}};
 const after=progress(d);assert(after.modules.find(m=>m.id==='reports').pending_review>before.modules.find(m=>m.id==='reports').pending_review);
 assert.equal(after.next_actions.find(a=>a.check_id==='typology').responsible,'Responsável do cadastro');
 assert.equal(after.next_actions.find(a=>a.check_id==='typology').due_on,'2026-12-01');
 assert.equal(after.next_actions.find(a=>a.check_id==='consent').responsible,'Coordenação sintética');
 assert.equal(after.readiness_percent,before.readiness_percent);assert(after.verified_percent<before.verified_percent);
});
test('progress view preserves the approved normative page and escapes project and assignment content',()=>{
 const d=fixture(),analysis={progress:progress(d)},esc=v=>String(v??'').replaceAll('<','&lt;'),ctx={analysis,current:{name:'<script>untrusted'},view:'norms',esc,num:String,button:()=>'',table:()=>'',td:()=>'',projectSelector:()=>''};
 assert.equal(renderProjectProgress(ctx),'');ctx.view='diagnosis';const html=renderProjectProgress(ctx);
 assert(html.includes('Acompanhamento integrado'));assert(!html.includes('<script>untrusted'));assert(html.includes('&lt;script>untrusted'));
 assert(html.includes('não é probabilidade de aprovação'));
});
