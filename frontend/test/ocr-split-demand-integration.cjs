/* Isolated DOM: real tariff memory and preparation screen, no production writes. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const {JSDOM}=require('jsdom');const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});
for(const k of ['window','document','HTMLElement','HTMLSelectElement','HTMLInputElement','HTMLTextAreaElement','Event','MouseEvent'])global[k]=dom.window[k];global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file);

let handler=async()=>({rows:[],canValidate:true});let calls=[];
const ui={Button:({children,variant,...p})=>React.createElement('button',{'data-variant':variant,...p},children),Input:({label,...p})=>React.createElement('label',null,label,React.createElement('input',p)),Card:({title,children})=>React.createElement('section',null,React.createElement('h2',null,title),children),Alert:({children})=>React.createElement('div',{role:'alert'},children)};
const original=Module._load;Module._load=function(name,parent,main){if(name==='@/app/components/ui')return ui;if(name==='@/app/providers')return {useAuth:()=>({hasPermission:()=>true})};if(name==='@/app/lib/api/client')return {apiRequest:async(url,options)=>{calls.push({url,options});return handler(url,options);}};if(name.startsWith('@/app/'))return original.call(this,path.resolve(__dirname,'..',name.slice(2)),parent,main);return original.call(this,name,parent,main);};


const Integration=require('../app/backoffice/documents/OcrSplitDemandIntegration.tsx').default;
const root=createRoot(document.getElementById('root'));let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;};const button=t=>Array.from(document.querySelectorAll('button')).find(x=>x.textContent===t);
const ready={token:'a'.repeat(64),state:'READY',canCreate:true,message:'Nova versão mensal e duas tarifas em rascunho.',targetVersion:2,parameterIds:[]};
(async()=>{try{
 let refreshed=0;let state=ready;handler=async(url,o)=>{if(o?.method==='POST'){state={...ready,state:'INTEGRATED',canCreate:false,inputId:'new',parameterIds:['a','b']};return {inputId:'new'};}return state;};
 await act(async()=>root.render(React.createElement(Integration,{documentId:'doc',onIntegrated:async()=>{refreshed++;}})));
 ok(calls.every(c=>c.options?.method!=='POST'),'opening never writes');ok(document.body.textContent.includes('Versão mensal de destino: 2'),'target version visible');
 await act(async()=>button('Integrar parcelas e tarifas automaticamente').click());const posts=calls.filter(c=>c.options?.method==='POST');ok(posts.length===1,'one mutation');assert.deepEqual(posts[0].options.body,{token:ready.token});checks++;ok(document.body.textContent.includes('Integração salva'),'success confirmation');ok(refreshed===1,'preparation automatically refreshed');ok(!button('Integrar parcelas e tarifas automaticamente'),'repeat disabled after success');ok(document.body.textContent.includes('2 tarifas'),'both parameters visible');
 await act(async()=>root.render(React.createElement('div')));calls=[];handler=async(url,o)=>{if(o?.method==='POST')throw Error('Conflict');return ready;};
 await act(async()=>root.render(React.createElement(Integration,{documentId:'doc2'})));await act(async()=>button('Integrar parcelas e tarifas automaticamente').click());ok(document.body.textContent.includes('não foi confirmada'),'failure is explicit');ok(!document.body.textContent.includes('Integração salva'),'no false success');
 handler=async()=>({...ready,state:'REVIEW_REQUIRED',canCreate:false});await act(async()=>button('Atualizar integração das parcelas').click());ok(!button('Integrar parcelas e tarifas automaticamente'),'pending review blocks submission');
 console.log(checks+' split demand integration interface checks passed');
}finally{await act(async()=>root.unmount());dom.window.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
