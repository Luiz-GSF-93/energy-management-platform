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

async function fill(name,value){const element=document.querySelector('[name="'+name+'"]');assert.ok(element,name);await act(async()=>{if(element.tagName==='SELECT'){element.value=value;element.dispatchEvent(new Event('change',{bubbles:true}));}else{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));}});}
(async()=>{try{
 let calls=[];
 request=async(url)=>{calls.push(url);return {rows:[{id:'event-'+new URL('https://test.invalid'+url).searchParams.get('page'),revision:1,created_at:'2026-10-11T00:00:00Z',actor_id:'original-id',details:{actorNameAtTime:'Historical Name',requesterNameAtTime:'Original Requester',assigneeNameAtTime:'Original Support',reason:'Preserved response'},currentActorName:'Current Name'}],total:26};};
 await render(require('../app/backoffice/platform-workflows/AdministrativeHistory.tsx').default,{kind:'support',id:'assigned-case'});
 assert.equal(calls.length,0);await toggle('Versões e histórico preservados');assert.match(calls.at(-1),/assigned-case\/history\?page=0/);
 assert.ok(document.body.textContent.includes('Historical Name'));assert.ok(document.body.textContent.includes('Current Name'));await click('Próxima');assert.match(calls.at(-1),/page=1/);
 await toggle('Versões e histórico preservados',false);await toggle('Versões e histórico preservados');assert.match(calls.at(-1),/page=1/);

 calls=[];request=async(url)=>{calls.push(url);return {rows:[],total:0,ownerCount:2,history:[]};};
 await render(require('../app/backoffice/platform-team/page.tsx').default);
 await toggle('Filtros da equipe');await fill('search','Ana');await fill('profile','FINANCE');await fill('active','false');await click('Filtrar equipe');
 const teamUrl=new URL('https://test.invalid'+calls.at(-1));assert.equal(teamUrl.pathname,'/api/v1/admin/platform-administration/team');assert.equal(teamUrl.searchParams.get('search'),'Ana');assert.equal(teamUrl.searchParams.get('profile'),'FINANCE');assert.equal(teamUrl.searchParams.get('active'),'false');assert.equal(teamUrl.searchParams.get('page'),'0');
 await toggle('Consultar auditoria da equipe');assert.ok(calls.at(-1).includes('/audit?'));
 request=async()=>{throw Error('fixture unavailable')};await click('Atualizar histórico');assert.ok(document.body.textContent.includes('Histórico indisponível ou acesso alterado.'));

 calls=[];request=async(url)=>{calls.push(url);return {rows:[],total:0,profile:'OWNER',supportMembers:[],organizations:[]};};
 await render(require('../app/backoffice/platform-workflows/Workspace.tsx').default,{kind:'support'});
 await toggle('Filtros avançados');await fill('search','Case one');await fill('priority','HIGH');await fill('from','2026-10-01');await fill('to','2026-10-31');await click('Filtrar');
 const supportUrl=new URL('https://test.invalid'+calls.at(-1));assert.equal(supportUrl.pathname,'/api/v1/admin/platform-administration/support');assert.equal(supportUrl.searchParams.get('priority'),'HIGH');assert.equal(supportUrl.searchParams.get('from'),'2026-10-01');assert.equal(supportUrl.searchParams.get('page'),'0');

 console.log('PASS: independent history pagination, historical/current names, unavailable history, team and support server filters.');
 }finally{await act(async()=>root.unmount());dom.window.close();Module._load=original;}})().catch(e=>{console.error(e);process.exitCode=1;});
