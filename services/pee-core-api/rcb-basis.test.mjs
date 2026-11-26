import test from 'node:test';import assert from 'node:assert/strict';
import {assessProject}from'./evaluation.mjs';
import {validateResources}from'./project-detail.mjs';
import {validateSimulation}from'./project-policy.mjs';
function fixture(){
 const p={id:'p',company_id:'c',unit_id:'u',name:'Synthetic chiller',distributor:'CPFL Paulista',typology:'Comércio e Serviços',call_name:'Synthetic CPP',call_url:'https://www.gov.br/aneel',economics:{energy_cost:455.11,demand_cost:723.45,discount_rate:8,shared_cost:155250,shared_life:15},sections:{}};
 p.resources=validateResources([{name:'Synthetic materials',category:'Materiais',quantity:1,unit_price:1100000,pee:50000,own:1050000,life:15},{name:'Synthetic services and CPFL costs',category:'Serviços',quantity:1,unit_price:505250,pee:505250,own:0,life:15}]);
 return{project:p,company:{id:'c',cnpj:'11222333000181'},unit:{id:'u',company_id:'c'},simulations:[{id:'s',...validateSimulation({project_id:'p',name:'Synthetic replacement',type:'CA',boundary:'chiller',maker:'Fixture',model:'Fixture',inputs:{thermal:500,oldCop:2.5,newCop:2.5/.68,hours:3000,coincidence:0},cost:1450000,life:15,selected:true})}],documents:[],rule:{id:'r',version:1,name:'Synthetic CPP',edition:'Fixture',source_url:'https://www.gov.br/aneel',reviewed:true,rcb_basis:'pee',max_rcb:.85,requirements:[]}};
}
test('PEE limit does not reject a reconciled counterpart project solely because total RCB exceeds the limit',()=>{
 const a=assessProject(fixture());assert.ok(a.economy.rcb_total>2);assert.ok(Math.abs(a.economy.rcb_pee-.74237552489285)<1e-10);
 assert.equal(a.qualification.checks.find(x=>x.id==='rcb').state,'pass');assert.ok(!a.issues.some(x=>/RCB acima|RCB em relação/.test(x)));
 assert.ok(a.issues.length>0,'Unprovided documents and reviews must still prevent submission');
});
test('total-cost calls still reject the same total RCB',()=>{const d=fixture();d.rule.rcb_basis='total';const a=assessProject(d);assert.equal(a.qualification.checks.find(x=>x.id==='rcb').state,'fail');assert.ok(a.issues.includes('RCB acima do limite cadastrado do edital'));});
test('PEE calls still reject excess PEE RCB',()=>{const d=fixture();d.project.resources[0].pee_cents+=105000000;d.project.resources[0].own_cents=0;const a=assessProject(d);assert.equal(a.qualification.checks.find(x=>x.id==='rcb').state,'fail');assert.ok(a.issues.some(x=>x.includes('RCB em relação')&&x.includes('impedimento')));});
test('missing or unreconciled funding cannot bypass a PEE limit',()=>{for(const change of [p=>p.resources=[],p=>p.resources[0].total_cents+=2]){const d=fixture();change(d.project);const a=assessProject(d);assert.equal(a.economy.rcb_pee,null);assert.equal(a.qualification.checks.find(x=>x.id==='rcb').state,'inconclusive');assert.ok(a.issues.some(x=>x.includes('RCB em relação')));}});
test('an unreviewed PEE rule cannot become a passed qualification',()=>{const d=fixture();d.rule.reviewed=false;const a=assessProject(d);assert.equal(a.qualification.checks.find(x=>x.id==='rcb').state,'present');assert.ok(a.issues.some(x=>x.includes('RCB em relação')&&x.includes('aguarda revisão')));});

