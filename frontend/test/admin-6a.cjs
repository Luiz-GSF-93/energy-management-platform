const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const {JSDOM}=require('jsdom'),dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});
for(const k of ['window','document','HTMLElement','HTMLInputElement','Event','MouseEvent','FormData'])global[k]=dom.window[k];
global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file);
require.extensions['.css']=()=>{};
const ui={Button:({children,variant,...p})=>React.createElement('button',{type:'button',...p},children),Alert:({children})=>React.createElement('div',{role:'alert'},children),Input:({label,...p})=>React.createElement('label',null,label,React.createElement('input',p)),Card:({title,children})=>React.createElement('section',null,title,children)};
const original=Module._load;let request,sections=[];
const stubs=new Set(['ClicksignConnection','SignaturePreparation','ProvisioningCommands','ActivationPreparation','RecurrencePreparation','PlanRecommendation','CommercialWorkspace','ContractDrafts','AsaasSandbox','SandboxCreation','ConsolidatedFinance']);
function stub(name){return {__esModule:true,default:()=>{React.useEffect(()=>{sections.push(name)},[]);return React.createElement('p',null,name)}};}
Module._load=function(name,parent,main){
 if(name==='@/app/components/ui')return ui;
 if(name==='@/app/lib/api/client')return {apiRequest:(...args)=>request(...args),ApiError:Error};
 if(name==='@/app/providers')return {useAuth:()=>({context:{scope:'global',user:{id:'owner'}},hasPermission:()=>true})};
 if(['@/app/components/BackofficeShell','@/app/components/ProtectedRoute'].includes(name))return {__esModule:true,default:({children})=>children};
 if(name==='../contracts/WorkflowModal')return {__esModule:true,default:({title,children,onClose})=>React.createElement('div',{role:'dialog','aria-label':title},React.createElement('button',{onClick:onClose},'Fechar'),children)};
 if(name==='@/app/components/WhatsappTemplates')return stub('WhatsappTemplates');
 if(stubs.has(name.split('/').at(-1)))return stub(name.split('/').at(-1));
 return original.call(this,name,parent,main);
};
const root=createRoot(document.getElementById('root'));
const render=async(Component,props={})=>act(async()=>root.render(React.createElement(Component,props)));
async function toggle(title,open=true){const summary=[...document.querySelectorAll('summary')].find(x=>x.textContent===title);assert.ok(summary,title);await act(async()=>{summary.parentElement.open=open;summary.parentElement.dispatchEvent(new Event('toggle'));});}
async function click(title){const button=[...document.querySelectorAll('button')].find(x=>x.textContent===title);assert.ok(button,title);assert.equal(button.disabled,false);await act(async()=>button.click());}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
(async()=>{try{
 const AdministrativeSection=require('../app/backoffice/platform-workflows/AdministrativeSection.tsx').default;
 let mounts=0;function Draft(){React.useEffect(()=>{mounts++},[]);const [id]=React.useState('uncertain-request-original');return React.createElement('input',{defaultValue:id});}
 await render(AdministrativeSection,{title:'Preserved draft',children:React.createElement(Draft)});
 assert.equal(mounts,0);await toggle('Preserved draft');assert.equal(mounts,1);
 const input=document.querySelector('input');input.value='pending-request-do-not-repeat';
 await toggle('Preserved draft',false);await toggle('Preserved draft');assert.equal(mounts,1);assert.equal(document.querySelector('input').value,'pending-request-do-not-repeat');

 request=async()=>({rows:[],total:0});sections=[];
 await render(require('../app/backoffice/platform-sales/page.tsx').default);
 assert.deepEqual(sections,[],'closed commercial areas must not mount or query');
 await toggle('Contratos e assinaturas');assert.deepEqual(sections,['ClicksignConnection']);
 await toggle('Assinatura eletrônica · sandbox');assert.deepEqual(sections,['ClicksignConnection','SignaturePreparation']);
 await toggle('Contratos e assinaturas',false);await toggle('Contratos e assinaturas');assert.equal(sections.filter(x=>x==='SignaturePreparation').length,1);

 const row={id:'one',organization_name:'Organization A',flow:'REPORT',processing:'ACCEPTED',receipt:'receipt-one',created_at:'2026-10-11T00:00:00Z',delivery:'PENDING',event_count:1,last_at:null,errors:[],association:'LINKED'};
 request=async()=>({rows:[row],total:1,messages:1,organizations:[]});sections=[];
 await render(require('../app/backoffice/platform-communications/CommunicationsWorkspace.tsx').default);
 assert.equal(sections.includes('WhatsappTemplates'),false);
 await click('Detalhes');assert.ok(document.querySelector('[role=dialog]').textContent.includes('receipt-one'));
 assert.ok(document.querySelector('[role=dialog]').textContent.includes('Não apurado. Entrega não comprova cobrança.'));
 await click('Fechar');assert.equal(document.querySelector('[role=dialog]'),null);
 await toggle('Modelos e configuração na Meta');assert.equal(sections.includes('WhatsappTemplates'),true);

 const pending=deferred();let lists=0;
 request=async(url)=>{if(url.endsWith('/one'))return pending.promise;lists++;return {rows:[{...row,company:'Organization A',paymentId:'pay_one',proposalId:'proposal',expectedCents:100,status:'PENDING',grossCents:null,netCents:null,checkedAt:null}],total:1};};
 await render(require('../app/backoffice/platform-reconciliation/SalesFinance.tsx').default);
 await click('Detalhes');await click('Atualizar acompanhamento');assert.ok(lists>=2);
 await act(async()=>pending.resolve({binding:{company:'OLD DETAIL',paymentId:'pay_one',proposalId:'proposal',expectedCents:100},events:[]}));
 assert.equal(document.querySelector('[role=dialog]'),null,'a late detail must not reopen after refresh');
 const pendingCase=deferred();
 const ticket={id:'case-one',revision:1,status:'OPEN',title:'Assigned case',organizationName:'Organization A',requesterName:'Requester',assigneeName:'Support',deadline:'2026-10-20',priority:'NORMAL',history:[]};
 request=async(url)=>url.includes('?id=')?pendingCase.promise:{rows:[ticket],total:1,profile:'SUPPORT',supportMembers:[],organizations:[]};
 await render(require('../app/backoffice/platform-workflows/Workspace.tsx').default,{kind:'support'});
 await click('Conferir');
 await act(async()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 await act(async()=>pendingCase.resolve({rows:[ticket],total:1,profile:'SUPPORT',supportMembers:[],organizations:[]}));
 assert.equal(document.querySelector('[role=dialog]'),null,'a late support detail must not reopen after filtering');
 console.log('PASS: lazy administrative areas, preserved pending draft, communication modal, on-demand templates and stale finance/support detail rejection.');
 }finally{await act(async()=>root.unmount());dom.window.close();Module._load=original;}})().catch(e=>{console.error(e);process.exitCode=1;});
