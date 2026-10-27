const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript'),{JSDOM}=require('jsdom');
const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});for(const k of ['window','document','HTMLElement','HTMLInputElement','HTMLSelectElement','FormData','Event','MouseEvent'])global[k]=dom.window[k];global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file);
let api;const load=Module._load;Module._load=function(name,parent,main){if(name==='@/app/lib/api/client')return{apiRequest:(p,o)=>api(p,o)};if(name==='@/app/components/ui')return load.call(this,require('node:path').resolve(__dirname,'../app/components/ui'),parent,main);return load.call(this,name,parent,main)};
const C=require('../app/backoffice/ccee-registrations/ProviderOperations.tsx').default,root=createRoot(document.getElementById('root'));let checks=0;const ok=v=>{assert.ok(v);checks++;};let tick;const interval=global.setInterval,clear=global.clearInterval;global.setInterval=fn=>{tick=fn;return 1};global.clearInterval=()=>{};Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});
const calls=[],binding={id:'binding',status:'APPROVED',representation_kind:'TOTAL',customer_name:'Synthetic customer',unit_name:'Synthetic unit',profile_code:'1234'};
const state={organizationId:'org_default',readEnabled:true,commands:[{id:'job',month:'2026-09-01',operation:'CONTRACTS',state:'QUEUED',requests:0}]};
const click=text=>act(async()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent===text);assert.ok(b,text);b.click();});
(async()=>{try{
 api=async(p,o)=>{calls.push([p,o]);if(p==='/api/v1/ccee-data')return{organizationId:'org_default',bindings:[binding]};return state;};
 await act(async()=>root.render(React.createElement(C,{organizationId:'org_default',canManage:true,canApprove:true})));
 ok(document.body.textContent.includes('Na fila'));ok(document.body.textContent.includes('Transmissão real de produção desativada'));ok(calls.every(c=>!c[1]));
 const month=document.querySelector('input[type=month]');month.focus();month.value='2026-09';const before=document.activeElement;await act(async()=>{tick();await Promise.resolve();});ok(document.activeElement===before);ok(month.value==='2026-09');ok(calls.every(c=>!c[1]));
 api=async(p)=>p.endsWith('/history')?{organizationId:'org_default',rows:[]}:{organizationId:'org_default',command:{id:'job',month:'2026-09-01',operation:'CONTRACTS',state:'SUCCEEDED',requests:1,role:'COMPRADOR',authorization_id:'binding',source_hash:'a'.repeat(64),result:{rows:[{id:'88',tipo:{nome:'CCEAL'}}],sourceHash:'a'.repeat(64),transactions:[]}}};
 await click('Ver fonte e histórico');ok(document.body.textContent.includes('Consulta concluída'));ok(document.querySelector('select[name=contractId] option').value==='88');ok(![...document.querySelectorAll('button')].some(x=>x.textContent==='Enviar à CCEE'));
 api=async()=>({...state,organizationId:'foreign',commands:[{...state.commands[0],operation:'PRIVATE_FOREIGN'}]});await click('Atualizar andamento das consultas');ok(!document.body.textContent.includes('PRIVATE_FOREIGN'));ok(document.body.textContent.includes('fora da organização'));
 await act(async()=>root.unmount());console.log(checks+' CCEE provider operation UI checks passed');
}catch(e){console.error(e);process.exitCode=1;}finally{global.setInterval=interval;global.clearInterval=clear;dom.window.close();}})();
