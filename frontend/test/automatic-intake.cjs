const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),Module=require('node:module'),ts=require('typescript');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
require.extensions['.css']=(m)=>m.exports={};
const React=require('react'),{JSDOM}=require('jsdom'),dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
for(const k of ['window','document','navigator','HTMLElement','Event','MouseEvent'])Object.defineProperty(global,k,{value:dom.window[k],configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
let serverRevision=null,serverRows=[{id:'receipt',filename:'invoice.pdf',state:'REVIEW_REQUIRED',month:null,documentId:null,note:'Conferir somente o vínculo.'}];const requests=[],original=Module._load;
Module._load=function(n,p,m){if(n==='@/app/lib/api/client')return {apiRequest:async(url,options)=>{requests.push([url,options]);if(options?.responseType==='blob')return new Blob(['original'],{type:'application/pdf'});return {enabled:true,revision:serverRevision,rows:serverRows};}};if(n==='@/app/backoffice/documents/DocumentDialog')return original.call(this,path.resolve('app/backoffice/documents/DocumentDialog.tsx'),p,m);return original.call(this,n,p,m);};
const Component=require('../app/components/AutomaticInvoiceIntake.tsx').default,{createRoot}=require('react-dom/client'),root=createRoot(document.getElementById('root')),{act}=React;
(async()=>{try{
 await act(async()=>root.render(React.createElement(Component,{customers:[{id:'client',company_name:'Synthetic client'}],units:[{id:'unit',customer_id:'client',name:'Synthetic unit',consumer_unit_number:'123'}]})));
 assert(requests[0][0].includes('queueOnly=true'),'The visible reading queue must request only pending receipts');
 const button=label=>[...document.querySelectorAll('button')].find(b=>b.textContent===label);
 await act(async()=>button('Enviar para a EVA').click());const form=document.querySelector('form');assert(form);assert.deepEqual([...form.querySelectorAll('[name]')].map(v=>v.name).sort(),['consent','file']);assert(document.querySelector('[role="dialog"]').textContent.includes('Não é necessário cadastrar a competência'));
 const count=requests.length;await act(async()=>window.dispatchEvent(new Event('focus')));assert.equal(requests.length,count,'focus cannot submit or restart recognition');
 await act(async()=>button('Fechar').click());await act(async()=>button('Conferir identificação').click());assert(document.querySelector('[role="dialog"]').textContent.includes('não aprova a leitura nem os valores'));assert(document.querySelector('select[name="unitId"]'));assert(document.querySelector('input[name="month"]'));
 assert(requests.every(([,o])=>!o?.method||o.method==='GET'),'opening a receipt cannot write or approve');
 let updates=0;serverRows=[];serverRevision='r1';await act(async()=>root.render(React.createElement(Component,{key:'empty-queue',onUpdated:()=>updates++})));serverRevision='r2';await act(async()=>button('Atualizar andamento').click());assert.equal(updates,1,'A completed upload between polls refreshes the catalog even with an empty queue');assert.equal(document.querySelectorAll('article').length,0);
 console.log('Automatic intake UI: upload without context fields, stable focus, guided identity-only review and read-only navigation passed');
}finally{await act(async()=>root.unmount());Module._load=original;}})().catch(e=>{console.error(e);process.exitCode=1});
