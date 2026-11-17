/* Mocked APIs and isolated DOM; no production access or financial actions. */
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript'),{JSDOM}=require('jsdom');
const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});for(const key of ['window','document','HTMLElement','Event','MouseEvent'])global[key]=dom.window[key];global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');for(const ext of ['.ts','.tsx'])require.extensions[ext]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file);
let context={scope:'organization',currentOrganization:{id:'a'}},permission=true,requests=[],api;const original=Module._load;
Module._load=function(name,parent,main){if(name==='@/app/providers')return {useAuth:()=>({context,hasPermission:()=>permission})};if(name==='@/app/lib/api/client')return {apiRequest:(path,options)=>{requests.push({path,options});return api(path,options);}};if(['@/app/components/BackofficeShell','@/app/components/ProtectedRoute'].includes(name))return {__esModule:true,default:({children})=>children};if(name==='next/link')return {__esModule:true,default:({href,children})=>React.createElement('a',{href},children)};if(name==='./LegalAuditWorkspace')return {__esModule:true,default:()=>null};if(name==='../documents/OcrAssistant')return {__esModule:true,default:props=>React.createElement('div',{'data-assistant':props.id},props.openRequest)};return original.call(this,name,parent,main);};
const Page=require('../app/backoffice/ocr-audit/page.tsx').default,root=createRoot(document.getElementById('root'));
const render=()=>act(async()=>root.render(React.createElement(Page)));
(async()=>{try{
 api=async()=>{throw Error('The page must not fetch invoices');};await render();assert.equal(requests.length,0);assert.equal(document.querySelector('table'),null);assert(!document.body.textContent.includes('Conferência de faturas'));assert.equal(document.querySelector('[data-assistant]'),null);
 context={scope:'global'};await render();assert(document.querySelector('[role=alert]'));assert.equal(requests.length,0);
 context={scope:'organization',currentOrganization:{id:'b'}};permission=false;await render();assert(document.querySelector('[role=alert]'));assert.equal(requests.length,0);
 console.log('Contract-only audit page passed: no invoice fetch, no invoice assistant, organization and permission gates retained.');
 }finally{await act(async()=>root.unmount());dom.window.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
