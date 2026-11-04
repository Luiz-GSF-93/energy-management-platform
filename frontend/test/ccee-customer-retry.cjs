const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript'),{JSDOM}=require('jsdom');
const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});for(const k of ['window','document','HTMLElement','HTMLInputElement','HTMLSelectElement','FormData','Event','MouseEvent'])global[k]=dom.window[k];global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file);
let api;const load=Module._load;Module._load=function(name,parent,main){if(name==='@/app/lib/api/client')return{apiRequest:(p,o)=>api(p,o)};if(name==='@/app/components/ui')return load.call(this,require('node:path').resolve(__dirname,'../app/components/ui'),parent,main);return load.call(this,name,parent,main)};
const C=require('../app/backoffice/ccee-data/CustomerRetry.tsx').default,root=createRoot(document.getElementById('root'));let checks=0,reloaded=0;const ok=v=>{assert.ok(v);checks++};
const id='11111111-1111-4111-8111-111111111111';let calls=[];
const render=(org='o1',rid=id)=>act(async()=>root.render(React.createElement(C,{organizationId:org,discoveryId:rid,taxId:'11111111000111',onReload:()=>{reloaded++}})));
const submit=()=>act(async()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
async function complete(){await act(async()=>{const el=document.querySelector('textarea');Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(el,'Reviewed the exact same CNPJ and the rejected source before retry.');el.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('input[type=checkbox]').click();});}
(async()=>{try{
 api=async(p,o)=>{calls.push({p,body:o.body});throw Error('Unconfirmed test response');};await render();ok(calls.length===0);ok(document.querySelector('button').disabled);await submit();ok(calls.length===0);
 await complete();ok(!document.querySelector('button').disabled);await submit();ok(calls.length===1);ok(calls[0].p.endsWith(id+'/retry'));ok(calls[0].body.confirmed===true);ok(document.body.textContent.includes('Unconfirmed test response'));
 api=async(p,o)=>{calls.push({p,body:o.body});return{organizationId:'o1',previousId:id,id:'new-row'};};await submit();ok(calls.length===2);ok(calls[0].body.requestId===calls[1].body.requestId);ok(reloaded===1);
 await render('o2','22222222-2222-4222-8222-222222222222');await complete();api=async()=>({organizationId:'foreign',previousId:'22222222-2222-4222-8222-222222222222',secret:'foreign secret'});await submit();ok(reloaded===1);ok(document.body.textContent.includes('Resposta fora do cadastro autorizado'));ok(!document.body.textContent.includes('foreign secret'));
 console.log('Reviewed customer retry UI: '+checks+' assertions passed');
 }finally{await act(async()=>root.unmount());dom.window.close();}})().catch(e=>{console.error(e);process.exitCode=1});
