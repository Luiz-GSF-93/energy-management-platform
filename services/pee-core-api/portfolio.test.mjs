import test from 'node:test';import assert from 'node:assert/strict';
import {summarizePortfolio}from'./portfolio.mjs';
import {renderPortfolio}from'./web/workspace-portfolio.mjs';
test('portfolio keeps losses and pending scores distinct from qualified projects',()=>{
 const s=summarizePortfolio([{investment:100,energy_mwh:25,score:70},{investment:200,energy_mwh:-5,score:69},{investment:null,energy_mwh:null,score:null}]);
 assert.deepEqual(s,{projects:3,investment:300,energy_mwh:20,score_at_least_70:1,pending_score:1,pending_economics:1});
});
test('portfolio chart and highlights escape customer text and retain pending values',()=>{
 const esc=x=>String(x??'').replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
 const html=renderPortfolio([{id:'safe',name:'<script>alert(1)</script>',unit:'U',distributor:'D',investment:null,energy_mwh:-2,rcb:null,score:null,phase:'Elaboração'}],{esc,num:String,money:String,heading:()=>'',button:()=>'',table:(h,r)=>r.join(''),td:(...a)=>a.join(''),canEdit:()=>true});
 assert.ok(!html.includes('<script>'));assert.match(html,/A apurar/);assert.match(html,/negative/);assert.match(html,/Potencial por projeto/);
});
