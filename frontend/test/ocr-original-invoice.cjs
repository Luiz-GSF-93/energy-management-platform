const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const {JSDOM}=require('jsdom');const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});
for(const k of ['window','document','HTMLElement','HTMLDialogElement','Event','MouseEvent'])global[k]=dom.window[k];global.IS_REACT_ACT_ENVIRONMENT=true;
HTMLDialogElement.prototype.showModal=function(){this.open=true;};HTMLDialogElement.prototype.close=function(){this.open=false;};
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
let handler=async()=>({url:'https://storage.example/invoice.pdf?token=temporary'}),calls=[];
const original=Module._load;Module._load=function(n,p,m){if(n==='@/app/lib/api/client')return {apiRequest:async(...args)=>{calls.push(args);return handler(...args);}};return original.call(this,n,p,m);};
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');const {useOriginalInvoice}=require('../app/backoffice/documents/OcrOriginalInvoice.tsx');
let actions;function Harness({id='doc/id'}){const o=useOriginalInvoice(id);actions=o;return o.viewer;}
const root=createRoot(document.getElementById('root'));const button=t=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent===t);
(async()=>{try{
 await act(async()=>root.render(React.createElement(Harness)));
 assert.equal(calls.length,0,'does not fetch a private URL before user action');
 await act(async()=>actions.open(3));assert.equal(calls[0][0],'/api/v1/documents/doc%2Fid/preview');assert.equal(document.querySelector('iframe').src,'https://storage.example/invoice.pdf?token=temporary#page=3');assert.equal(document.querySelector('a').rel,'noopener noreferrer');assert.equal(document.querySelector('iframe').getAttribute('referrerpolicy'),'no-referrer');
 await act(async()=>button('Voltar à conferência').click());assert.equal(document.querySelector('iframe'),null);assert.equal(document.querySelector('dialog').open,false);
 await act(async()=>actions.open(-4));assert.ok(document.querySelector('iframe').src.endsWith('#page=1'));
 await act(async()=>document.querySelector('dialog').dispatchEvent(new Event('cancel',{cancelable:true})));assert.equal(document.querySelector('iframe'),null);
 let resolve;handler=()=>new Promise(r=>resolve=r);let pending;await act(async()=>{pending=actions.open(2);});await act(async()=>button('Voltar à conferência').click());await act(async()=>{resolve({url:'https://storage.example/stale.pdf'});await pending;});assert.equal(document.querySelector('iframe'),null,'late request cannot restore a closed document');
 handler=async()=>({url:'javascript:alert(1)'});await act(async()=>actions.open());assert.equal(document.querySelector('iframe'),null);assert.ok(document.querySelector('[role="alert"]'));
 handler=async()=>{throw new Error('private technical failure');};await act(async()=>button('Atualizar acesso ao PDF').click());assert.ok(!document.body.textContent.includes('private technical failure'));
 handler=async()=>({url:'https://storage.example/fresh.pdf'});await act(async()=>button('Atualizar acesso ao PDF').click());assert.ok(document.querySelector('iframe').src.includes('fresh.pdf'));
 handler=()=>new Promise(r=>resolve=r);await act(async()=>{pending=actions.open();});await act(async()=>root.render(React.createElement(Harness,{key:'new-org',id:'another-doc'})));await act(async()=>{resolve({url:'https://storage.example/old-org.pdf'});await pending;});assert.equal(document.querySelector('iframe'),null,'organization/document remount rejects old response');
 assert.ok(calls.every(c=>c.length===1),'preview only; no mutation request');console.log('Original invoice access, page, cancellation, retry and isolation checks passed');
}finally{await act(async()=>root.unmount());dom.window.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
