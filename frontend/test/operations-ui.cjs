const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const {JSDOM}=require('jsdom');const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});
for(const k of ['window','document','HTMLElement','HTMLInputElement','HTMLSelectElement','HTMLTextAreaElement','HTMLFormElement','FormData','Event','MouseEvent'])global[k]=dom.window[k];
global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file);
let calls=[],scope='organization';const hasPermission=()=>true;
const apiRequest=async(url)=>{calls.push(url);assert.ok(url.startsWith('/api/v1/'),'Deployed API requires version prefix');if(url.includes('/operations/')&&!url.endsWith('/responsible'))return {rows:[],canManage:true,canPublish:false};return [];};
const original=Module._load;Module._load=function(name,parent,main){
 if(name==='@/app/providers')return {useAuth:()=>({context:scope==='global'?{scope,user:{id:'actor'}}:{scope,user:{id:'actor'},currentOrganization:{id:'org-a',permissions:[]}},hasPermission})};
 if(name==='@/app/lib/api/client')return {apiRequest};
 if(name==='@/app/lib/operations')return original.call(this,require('node:path').resolve(__dirname,'../app/lib/operations.ts'),parent,main);
 if(name==='next/link')return {__esModule:true,default:({children,...p})=>React.createElement('a',p,children)};
 return original.call(this,name,parent,main);
};
const Workspace=require('../app/components/OperationsWorkspace.tsx').default,root=createRoot(document.getElementById('root'));
(async()=>{try{
 for(const area of ['agenda','requests','events','notifications']){await act(async()=>root.render(React.createElement(Workspace,{area})));assert.equal(document.querySelector('[role="alert"]'),null);assert.ok(document.body.textContent.includes(area==='notifications'?'Nenhuma notificação':'Nenhum registro'));}
 const count=calls.length;await act(async()=>root.render(React.createElement(Workspace,{area:'pld'})));assert.ok(document.body.textContent.includes('Aguardando API CCEE'));assert.equal(calls.length,count);
 scope='global';await act(async()=>root.render(React.createElement(Workspace,{area:'agenda'})));assert.ok(document.body.textContent.includes('Acesso indisponível'));assert.equal(calls.length,count);
 for(const path of ['/customers','/consumer-units','/documents','/operations/responsible'])assert.ok(calls.includes('/api/v1'+path));
 console.log('Operations UI: four real screens and linked lookups use versioned API; PLD stays paused; global scope makes no requests. PASS');
 }finally{await act(async()=>root.unmount());dom.window.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
