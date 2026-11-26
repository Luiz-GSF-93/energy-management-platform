import test from 'node:test';import assert from 'node:assert/strict';
import {createAuditWorkspace}from'./web/workspace-audit.mjs';
function fixture(){
 const doc=new EventTarget(),requests=[],downloads=[];let resolve;
 const ctx={document:doc,heading:(a,b,c)=>c,button:()=>'',field:()=>'',esc:String,table:()=>'',td:()=>'',render(){},modal(){},message(e){throw e},api:(path,body,blob)=>{requests.push(path);return blob?Promise.resolve('exported'):new Promise(r=>resolve=r)},saveBlob:(blob,name)=>downloads.push(name)};
 const workspace=createAuditWorkspace(ctx);
 const change=value=>{const e=new Event('change');Object.defineProperty(e,'target',{value:{id:'audit-export-format',value}});doc.dispatchEvent(e)};
 return{workspace,requests,downloads,change,complete:()=>resolve({items:[],total:0,snapshot:1,has_more:false})};
}
test('CSV choice survives a late audit response, refresh and export rerenders',async()=>{
 const f=fixture(),pending=f.workspace.afterRender();f.change('csv');f.complete();await pending;
 assert.match(f.workspace.pages.audit(),/value="csv" selected/);
 await f.workspace.action('audit-refresh');assert.match(f.workspace.pages.audit(),/value="csv" selected/);
 await f.workspace.action('export-trail');assert.ok(f.requests.at(-1).includes('format=csv'));assert.match(f.downloads[0],/\.csv$/);assert.match(f.workspace.pages.audit(),/value="csv" selected/);
});
test('audit export format defaults to JSON and accepts only the supported choices',async()=>{
 const f=fixture();await f.workspace.action('export-trail');assert.match(f.downloads[0],/\.json$/);
 f.change('csv');f.change('unrecognized');await f.workspace.action('export-trail');assert.match(f.downloads[1],/\.json$/);
});
