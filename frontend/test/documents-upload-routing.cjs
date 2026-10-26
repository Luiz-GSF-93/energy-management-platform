const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript'),{JSDOM}=require('jsdom');
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
for(const k of ['window','document','navigator','HTMLElement','Event'])Object.defineProperty(global,k,{value:dom.window[k],configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
require.extensions['.css']=(m)=>m.exports={};
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');let catalog,requests=[],autoEnabled=true;
const original=Module._load,invoice={id:'invoice',customer_id:'customer',consumer_unit_id:'unit',reference_month:'2026-07-01',document_type:'INVOICE_DISTRIBUTOR',original_filename:'invoice.pdf'};
Module._load=function(n,p,m){
 if(n==='@/app/providers')return {useAuth:()=>({context:{scope:'organization',currentOrganization:{id:'org',role:'admin_org'}},hasPermission:()=>true})};
 if(n==='@/app/lib/api/client')return {apiRequest:async(url,o)=>{requests.push([url,o]);return {documents:[],customers:[{id:'customer',company_name:'Synthetic customer'}],units:[{id:'unit',customer_id:'customer',name:'Unit',consumer_unit_number:'123'}]}}};
 if(n==='./DocumentCatalog')return {__esModule:true,documentTags:[['DRAFT','Rascunho'],['REVIEWED','Revisado']],default:props=>{catalog=props;return React.createElement('button',{onClick:props.onNew},'+ Inserir novo')}};
 if(n==='@/app/components/AutomaticInvoiceIntake')return {__esModule:true,default:({onEnabled})=>{React.useEffect(()=>{onEnabled(autoEnabled)},[onEnabled]);return React.createElement('button',null,'Enviar para a EVA')}};
 if(n==='./assistant-inbox')return {inboxScope:()=>'',readInbox:()=>[],writeInbox:()=>{}};
 if(['@/app/components/BackofficeShell','@/app/components/ProtectedRoute'].includes(n))return {__esModule:true,default:({children})=>children};
 if(['@/app/components/DocumentEvidenceWorkspace','./OcrDocumentStatus','./AssistantInbox'].includes(n))return {__esModule:true,default:()=>null};
 return original.call(this,n,p,m);
};
const Page=require('../app/backoffice/documents/page.tsx').default,root=createRoot(document.getElementById('root'));
(async()=>{try{
 await act(async()=>root.render(React.createElement(Page)));await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='+ Inserir novo').click());
 assert(document.querySelector('input[type=month][name=referenceMonth]'),'Detailed competence remains available');assert(document.querySelector('select[name=customerId]'));assert(document.querySelector('select[name=consumerUnitId]'));assert(document.querySelector('select[name=catalogTag]'));
 const types=[...document.querySelectorAll('select[name=documentType] option')].map(o=>o.value);assert(types.includes('CONTRACT_ENERGY'));assert(types.includes('OTHER'));assert(types.includes('COMPLIANCE_REPORT'));assert(!types.includes('INVOICE_DISTRIBUTOR'));assert(!types.includes('INVOICE_SUPPLIER'));
 assert(catalog.types.some(([v])=>v==='INVOICE_DISTRIBUTOR'),'Catalog invoice filters remain intact');
 await act(async()=>catalog.onVersion(invoice));assert(document.querySelector('select[name=documentType]').disabled);assert(document.querySelector('select[name=customerId]').disabled);assert(document.querySelector('input[name=referenceMonth]').disabled);assert(document.body.textContent.includes('Nova versão de invoice.pdf'));assert(document.body.textContent.includes('atribui a próxima versão'));
 assert(!requests.some(([,o])=>o?.method&&o.method!=='GET'),'Opening upload/version cannot submit or start OCR');
 autoEnabled=false;await act(async()=>root.render(React.createElement(Page,{key:'legacy-organization'})));await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='+ Inserir novo').click());assert(document.querySelector('select[name=documentType] option[value=INVOICE_DISTRIBUTOR]'),'Organizations without automatic intake retain their existing upload route');
 console.log('PASS document upload routing: detailed modal, non-invoice choices, intact catalog filters and immutable version context.');
}finally{await act(async()=>root.unmount());dom.window.close();}})().catch(e=>{console.error(e);process.exitCode=1});
