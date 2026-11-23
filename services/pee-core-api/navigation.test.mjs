import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('web/app.js',import.meta.url),'utf8');
const controller=source.slice(source.indexOf('// Module navigation'),source.indexOf('function message('));
function fixture(api){
 const renders=[],ctx={state:{identity:{role:'editor'}},selected:'a',analysis:null,view:'projects',portfolioRows:[],portfolioError:null,api,render:()=>renders.push(ctx.view),message:e=>{throw e},Promise,Set};
 runInNewContext(controller+'\nthis.controls={navigate,refreshPortfolio,refreshAnalysis,invalidate:()=>{dataRevision++;portfolioRows=[];},get revision(){return portfolioRevision}}',ctx);
 return {...ctx,ctx,renders,controls:ctx.controls};
}
test('module changes render immediately without waiting for or repeating API calls',()=>{
 let calls=0;const f=fixture(()=>{calls++;return new Promise(()=>{})});
 for(const v of ['economics','diagnosis','rules','documents','reports','norms'])f.controls.navigate(v);
 assert.deepEqual(f.renders,['economics','diagnosis','rules','documents','reports','norms']);assert.equal(calls,0);
});
test('dashboard refresh is nonblocking, deduplicated and follows all portfolio pages',async()=>{
 let release,calls=[];const f=fixture(path=>{calls.push(path);if(path==='portfolio')return new Promise(r=>release=r);return Promise.resolve({items:[{id:'second'}],next_cursor:null});});
 f.controls.navigate('dashboard');f.controls.navigate('dashboard');assert.equal(f.renders.length,2);assert.equal(calls.length,1);
 release({items:[{id:'first'}],next_cursor:'next'});await f.controls.refreshPortfolio();
 assert.deepEqual(calls,['portfolio','portfolio?after=next']);assert.deepEqual(Array.from(f.ctx.portfolioRows,p=>p.id),['first','second']);
 f.controls.navigate('dashboard');assert.equal(calls.length,2);
});
test('a late portfolio response cannot replace data invalidated by a write',async()=>{
 const pending=[];const f=fixture(()=>new Promise(r=>pending.push(r)));
 const old=f.controls.refreshPortfolio();f.controls.invalidate();const fresh=f.controls.refreshPortfolio();
 pending[1]({items:[{id:'new'}],next_cursor:null});await fresh;
 pending[0]({items:[{id:'old'}],next_cursor:null});await old;
 assert.equal(f.ctx.portfolioRows[0].id,'new');
});
test('fast project changes cannot attach another project analysis to the selected project',async()=>{
 const pending=[];const f=fixture(path=>new Promise(r=>pending.push({path,r})));
 const a=f.controls.refreshAnalysis();f.ctx.selected='b';const b=f.controls.refreshAnalysis();
 pending[1].r({project:'b'});await b;pending[0].r({project:'a'});await a;
 assert.equal(f.ctx.analysis.project,'b');
});
test('portfolio errors clear old indicators and remain available to display with retry',async()=>{
 const f=fixture(async()=>{throw Error('Permissão revogada')});await f.controls.refreshPortfolio();
 assert.equal(f.ctx.portfolioRows.length,0);assert.equal(f.ctx.portfolioError,'Permissão revogada');
});
