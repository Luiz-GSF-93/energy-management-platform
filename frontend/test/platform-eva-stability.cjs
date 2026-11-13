const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript'),{JSDOM}=require('jsdom');
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/backoffice/platform-stability',pretendToBeVisual:true});
for(const k of ['window','document','navigator','HTMLElement','Event'])Object.defineProperty(global,k,{value:dom.window[k],configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
require.extensions['.css']=m=>m.exports={};
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),original=Module._load;
let scope='organization',allowed=true,actor='owner',denied=false,requests=[];
const fixture={responsible:'OWNER',generatedAt:'2026-11-13T14:00:00Z',total:1,pageSize:25,windowDays:30,rows:[{organizationId:'licensed',organizationName:'Organização licenciada sintética',activeLicenses:1,attention:true,closingReceipts:2,manual:{queued:1,running:0,uncertain:1,failed30d:0,succeeded30d:5,oldestQueueSeconds:600},intakes:{processing:2,technical:1,human:3,sources:4,proposals30d:2}}],plan:{organizationRole:'Organização acompanha.',rolloutScope:'Ajustes para licenças ativas.',ownerAccess:'Owner acessa todos os módulos.',steps:[{id:'G',status:'Não atingida',description:'Não prometer ausência absoluta de falhas.'}]}};
Module._load=function(n,p,m){
 if(n==='@/app/providers')return {useAuth:()=>({context:{scope,user:{id:actor}},hasPermission:()=>allowed})};
 if(n==='@/app/lib/api/client')return {apiRequest:async(url,options)=>{requests.push({url,options});if(denied)throw Object.assign(Error('Owner required'),{status:403});return fixture;}};
 if(n==='@/app/components/ServiceAvailabilityPanel')return {__esModule:true,default:()=>React.createElement('section',null,'Serviços públicos separados')};
 if(['@/app/components/ProtectedRoute','@/app/components/BackofficeShell'].includes(n))return {__esModule:true,default:({children})=>children};
 if(n==='next/link')return {__esModule:true,default:({href,children})=>React.createElement('a',{href},children)};
 if(n.startsWith('@/'))return original.call(this,require('node:path').resolve(__dirname,'..',n.slice(2)),p,m);
 return original.call(this,n,p,m);
};
const Page=require('../app/backoffice/platform-stability/page.tsx').default,Status=require('../app/status/page.tsx').default,root=createRoot(document.getElementById('root'));
(async()=>{try{
 await act(async()=>root.render(React.createElement(Page)));assert(document.body.textContent.includes('exclusivo'));assert.equal(requests.length,0);
 scope='global';await act(async()=>root.render(React.createElement(Page)));assert(document.body.textContent.includes('Organização licenciada sintética'));assert(document.body.textContent.includes('Owner acessa todos os módulos'));assert(document.body.textContent.includes('Não atingida'));assert(requests.every(r=>!r.options.method||r.options.method==='GET'));assert(requests.every(r=>!r.url.includes('organizationId')&&!r.url.includes('actor=')));
 denied=true;await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Atualizar organizações').click());assert(!document.body.textContent.includes('Organização licenciada sintética'));assert(document.querySelector('[role="alert"]'));
 const count=requests.length;scope='organization';await act(async()=>root.render(React.createElement(Page)));assert.equal(requests.length,count);assert(!document.body.textContent.includes('Organização licenciada sintética'));
 const fetches=[];let healthy=true;process.env.NEXT_PUBLIC_API_URL='https://api.example.invalid';global.fetch=async(url,options)=>{fetches.push({url,options});return {ok:healthy,status:healthy?200:503,json:async()=>({status:healthy?'ready':'degraded',dependencies:{database:healthy?'up':'down',auth:healthy?'up':'down'},checkedAt:'2026-11-13T14:00:00Z'})};};
 await act(async()=>root.render(React.createElement(Status)));assert(document.body.textContent.includes('Banco de dados: disponível'));assert.equal(requests.length,count);assert(fetches.every(r=>r.options.credentials==='omit'&&r.options.cache==='no-store'&&r.options.method==='GET'&&r.url.endsWith('/api/v1/health/ready')));
 healthy=false;await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Atualizar disponibilidade').click());assert(document.body.textContent.includes('Banco de dados: indisponível'));assert(document.body.textContent.includes('Acesso e autenticação: indisponível'));assert(!document.body.textContent.includes('Organização licenciada sintética'));
 console.log('PASS Owner monitoring and public availability: organization denied, aggregates, plan, revocation clearing, GET only, no session transmission and Auth-down access.');
 }finally{await act(async()=>root.unmount());dom.window.close();}})().catch(e=>{console.error(e);process.exitCode=1});
