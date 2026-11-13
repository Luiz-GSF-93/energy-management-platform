const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript'),{JSDOM}=require('jsdom');
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/backoffice/documents/operations',pretendToBeVisual:true});
for(const k of ['window','document','navigator','HTMLElement','Event'])Object.defineProperty(global,k,{value:dom.window[k],configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
require.extensions['.css']=m=>m.exports={};
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),original=Module._load;
let org='tenant-a',permission=true,failed=false,failureStatus=null,requests=[];
const row={id:'receipt',filename:'Original preserved.pdf',state:'AWAITING_SOURCES',group:'SOURCES',note:'Campos comprovados preenchidos',customer:'Cliente sintético',unit:'Unidade sintética',month:'2026-07',documentId:'00000000-0000-4000-8000-000000000001',closingId:'closing',idleSeconds:3600,attempts:4,nextAttemptAt:null,requiredInputs:['Conferir CUSD e demanda contratada'],identityDecision:{decision:'CONTINUE',at:'2026-11-09T18:00:00Z'},explanationState:'FAILED'};
Module._load=function(n,p,m){
 if(n==='@/app/providers')return {useAuth:()=>({context:{scope:'organization',user:{id:'user'},currentOrganization:{id:org,role:'admin_org'}},hasPermission:()=>permission})};
 if(n==='@/app/lib/api/client')return {apiRequest:async(url,options)=>{if(url.includes('/preparation-requests/operations'))return {enabled:false};requests.push({url,options,org});if(failed)throw Object.assign(Error('offline'),{status:failureStatus});return {enabled:true,generatedAt:'2026-11-09T20:00:00Z',total:1,pageSize:25,windowDays:30,automationConfigured:true,summary:{received30d:1,prepared30d:1,technical:0,human:0,sources:1,processing:0},rows:[{...row,filename:org+' original.pdf'}]};}};
 if(['@/app/components/ProtectedRoute','@/app/components/BackofficeShell'].includes(n))return {__esModule:true,default:({children})=>children};
 if(n==='next/link')return {__esModule:true,default:({href,children})=>React.createElement('a',{href},children)};
 return original.call(this,n,p,m);
};
const Page=require('../app/backoffice/documents/operations/page.tsx').default,root=createRoot(document.getElementById('root'));
(async()=>{try{
 await act(async()=>root.render(React.createElement(Page)));
 assert(document.body.textContent.includes('Fontes pendentes'));assert(document.body.textContent.includes('Conferir CUSD'));assert(document.body.textContent.includes('continuar com justificativa'));assert(document.body.textContent.includes('proposta preservada'));
 assert(document.querySelector('a[href*="ocrDocument="]'),'Existing document navigation is reused');
 assert(requests.every(r=>!r.options.method||r.options.method==='GET'));assert(requests.every(r=>!r.url.includes('organizationId')));
 const select=document.querySelector('select[aria-label="Filtrar envios recebidos"]');await act(async()=>{select.value='TECHNICAL';select.dispatchEvent(new Event('change',{bubbles:true}));});assert(requests.at(-1).url.includes('group=TECHNICAL'));
 failed=true;await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Atualizar painel').click());assert(document.querySelector('[role="alert"]'));assert(document.body.textContent.includes('tenant-a original.pdf'),'Last successful data remain visible after a failed refresh');
 failed=false;org='tenant-b';await act(async()=>root.render(React.createElement(Page)));assert(!document.body.textContent.includes('tenant-a original.pdf'));assert(document.body.textContent.includes('tenant-b original.pdf'));
 failed=true;failureStatus=403;await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Atualizar painel').click());assert(!document.body.textContent.includes('tenant-b original.pdf'),'Access denial clears the cached document list');
 failed=false;failureStatus=null;await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Atualizar painel').click());assert(document.body.textContent.includes('tenant-b original.pdf'));
 const calls=requests.length;permission=false;await act(async()=>root.render(React.createElement(Page)));assert(document.body.textContent.includes('permissões'));assert(!document.body.textContent.includes('tenant-b original.pdf'));assert.equal(requests.length,calls);
 console.log('PASS EVA operational dashboard: pending sources, preserved identity, optional AI, safe navigation, stale-data error and tenant/access changes.');
}finally{await act(async()=>root.unmount());dom.window.close();}})().catch(e=>{console.error(e);process.exitCode=1});
