/* Queue integration in an isolated browser with mocked API. No production writes. */
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript'),{JSDOM}=require('jsdom');
const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});
for(const k of ['window','document','HTMLElement','Event','MouseEvent','File'])global[k]=dom.window[k];
global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file);
const permissions=['8f105b02-4443-49de-b188-847e0284e7ed','92e1b670-ab10-483a-b825-c6e16799496d','60f9690a-145b-4dba-b23f-9f945baca296','8f3ff5eb-157a-468a-91af-6f89d92e23a7'];
let context={scope:'organization',user:{id:'actor'},currentOrganization:{id:'org',role:'operacional',permissions}};
const ids=['7b909de6-6f2a-4523-85d9-90b8257a2c37','ddaed3b2-7c81-4b42-8cd0-00182e39ea2d','caabcbf9-b660-4fce-b33b-9f769ad8f51f'];
const documents=ids.map((id,i)=>({id,document_type:'INVOICE_DISTRIBUTOR',original_filename:'Invoice '+i,reference_month:'2026-08-01',file_verified:true,processing_status:'PENDING'}));
const mounted=new Map(),requests=[];const original=Module._load;
const newDocument={...documents[0],id:'12345678-1234-4123-a123-123456789abc',original_filename:'New upload.pdf'};
class UploadData{constructor(){this.data=new Map([['file',new File(['invoice'],'New upload.pdf',{type:'application/pdf'})],['referenceMonth','2026-08']]);}get(key){return this.data.get(key);}set(key,value){this.data.set(key,value);}}
global.FormData=UploadData;
Module._load=function(name,parent,main){
 if(name==='@/app/components/DocumentEvidenceWorkspace')return {__esModule:true,default:()=>null}; // The evidence channel has its own DOM and scope tests.
 if(['@/app/components/BackofficeShell','@/app/components/ProtectedRoute'].includes(name))return {__esModule:true,default:({children})=>React.createElement('div',null,children)};
 if(name==='@/app/components/ui/Button')return {Button:({variant,...props})=>{void variant;return React.createElement('button',props);}};
 if(name==='@/app/providers')return {useAuth:()=>({context,hasPermission:p=>context.currentOrganization.permissions.includes(p)})};
 if(name==='@/app/lib/api/client')return {apiRequest:async(p,o)=>{requests.push([p,o]);if(o){assert.equal(o.method,'POST');if(p==='/api/v1/documents/upload'){assert.equal(o.body.get('referenceMonth'),'2026-08-01');return newDocument;}assert.equal(p,'/api/v1/documents/'+newDocument.id+'/ocr');return {id:'ocr',state:'QUEUED'};}return p==='/api/v1/documents'?documents:p==='/api/v1/customers'?[{id:'cust',company_name:'Customer'}]:[];}};
 if(name==='./OcrDocumentStatus')return {__esModule:true,default:props=>{mounted.set(props.id,props);return React.createElement('div',null,props.autoAssist?'Preparing '+props.id:'Idle '+props.id);}};
 return original.call(this,name,parent,main);
};
const {inboxScope,writeInbox,readInbox}=require('../app/backoffice/documents/assistant-inbox.ts');
writeInbox(window.sessionStorage,inboxScope(context),ids.map(id=>({id,addedAt:Date.now()})));
const Page=require('../app/backoffice/documents/page.tsx').default,root=createRoot(document.getElementById('root'));
const click=async label=>act(async()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===label);assert.ok(b,label);b.click();});
(async()=>{try{
 await act(async()=>root.render(React.createElement(Page)));
 assert.equal([...mounted.values()].filter(v=>v.autoAssist).length,2,'Limit to two automatic inspections');
 assert.ok(document.body.textContent.includes('Invoice 0'));assert.ok(document.body.textContent.includes('fila de validação'));
 await act(async()=>mounted.get(ids[0]).onAssistantUpdate(ids[0],{state:'READY',message:'Ready',blockers:0,reviews:3,fields:1,proposals:2}));
 assert.equal(mounted.get(ids[2]).autoAssist,true,'Next item starts when a slot finishes');
 await click('Validar / revisar Invoice 0');assert.ok(mounted.get(ids[0]).openRequest>0);
 await click('Retirar da fila Invoice 0');assert.equal(readInbox(window.sessionStorage,inboxScope(context)).length,2);
 assert.ok(document.body.textContent.includes('Invoice 0'),'Removing a pointer must preserve the document');
 assert.ok(requests.every(([,options])=>!options),'Reload/scheduling/review/removal must not write or restart OCR');
 await act(async()=>document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
 assert.ok(readInbox(window.sessionStorage,inboxScope(context)).some(v=>v.id===newDocument.id),'New upload enters the recoverable queue automatically');
 assert.equal(requests.filter(([,options])=>options).length,2,'Only explicit upload and the existing OCR enqueue are written');
 mounted.clear();context={...context,currentOrganization:{...context.currentOrganization,id:'other-org'}};
 await act(async()=>root.render(React.createElement(Page)));
 assert.equal([...mounted.values()].filter(v=>v.autoAssist).length,0,'No automatic work from previous tenant');
 assert.ok(document.body.textContent.includes('Nenhuma fatura acompanhada'));
 assert.ok(requests.every(([path])=>!path.includes('/assistant/validate')&&!path.includes('settlement')),'No validation or financial writes');
 await act(async()=>root.unmount());console.log('Inbox UI: pointer reload, bounded scheduling, operator review, recoverable dismissal, source document preserved and tenant switch PASS');
}finally{dom.window.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
