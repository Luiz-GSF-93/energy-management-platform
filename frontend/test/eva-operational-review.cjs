const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript'),{JSDOM}=require('jsdom');
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});for(const k of ['window','document','navigator','HTMLElement','Event'])Object.defineProperty(global,k,{value:dom.window[k],configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');let calls=[],reply;const original=Module._load;
Module._load=function(n,p,m){if(n==='@/app/lib/api/client')return {apiRequest:async(...a)=>{calls.push(a);return reply}};if(n==='@/app/components/ui')return {Button:({children,variant,...props})=>React.createElement('button',props,children)};return original.call(this,n,p,m)};
const Review=require('../app/backoffice/contracts/EvaOperationalReview.tsx').default,root=createRoot(document.getElementById('root'));
const row={id:'closing',payload_hash:'a'.repeat(64),state:'READY_FOR_REVIEW',report:{approvalEligible:true}},props={unitId:'unit',month:'2026-01',row,onChanged:async()=>{}};
const button=()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Conferi · enviar ao gestor');
(async()=>{try{
 reply={enabled:true,canPrepare:true,review:{id:'review',closing_id:row.id,closing_hash:row.payload_hash,state:'READY_OPERATOR',revision:1}};
 await act(async()=>root.render(React.createElement(Review,props)));assert(button()?.disabled);assert.equal(calls.filter(c=>c[1]?.method==='POST').length,0);
 await act(async()=>{const el=document.querySelector('textarea');Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value').set.call(el,'Valores e fontes conferidos nesta proposta.');el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));document.querySelector('input[type=checkbox]').click()});
 assert.equal(button().disabled,false);await act(async()=>button().click());const post=calls.find(c=>c[1]?.method==='POST');assert.equal(post[0],'/api/v1/eva-assisted-closing/flow/submit');assert.equal(post[1].body.consumerUnitId,'unit');assert.equal(post[1].body.hash,row.payload_hash);assert.equal(post[1].body.confirmed,true);assert(!calls.some(c=>/decision|publication|ocr.*enqueue/.test(c[0])));
 reply={...reply,review:{...reply.review,closing_hash:'b'.repeat(64)}};await act(async()=>root.render(React.createElement(Review,{...props,key:'stale'})));assert(!button(),'A stale report cannot be submitted');
 reply={enabled:true,canPrepare:true,review:{id:'review',closing_id:row.id,closing_hash:row.payload_hash,state:'REQUIRES_INPUT'}};await act(async()=>root.render(React.createElement(Review,{...props,key:'missing',row:{...row,report:{approvalEligible:false}}})));assert(!button(),'Missing evidence cannot be submitted');
 await act(async()=>root.unmount());console.log('PASS operational review: explicit consent, exact version, unit scope, no automatic financial decision, stale/incomplete blocked.');
}catch(e){await act(async()=>root.unmount());throw e}})().catch(e=>{console.error(e);process.exitCode=1});
