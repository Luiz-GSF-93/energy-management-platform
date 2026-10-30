// Real React effects and entry pages; fake identity/API only, never production tokens.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const {JSDOM}=require('jsdom'),dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});
for(const k of ['window','document','HTMLElement','HTMLInputElement','Event','MouseEvent'])global[k]=dom.window[k];global.IS_REACT_ACT_ENVIRONMENT=true;
window.scrollTo=()=>{};
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
let context,authStatus='authenticated',api,calls=[],routes=[],authCalls=0;
const router={replace:p=>routes.push(p)},logout=()=>{authStatus='unauthenticated';context=null;};
let login=async()=>{authCalls++;};
const original=Module._load;Module._load=function(name,parent,main){
 if(name.endsWith('.css'))return {};
 if(name==='next/navigation')return {useRouter:()=>router,usePathname:()=>'/backoffice/dashboard'};
 if(name==='next/link')return {__esModule:true,default:({children,href,...p})=>React.createElement('a',{href,...p},children)};
 if(name==='@/app/providers')return {useAuth:()=>({context,status:authStatus,logout,login,hasPermission:()=>true})};
 if(name==='@/app/lib/api/client')return {apiRequest:(p,o)=>{calls.push([p,o]);return api(p,o);}};
 if(name==='@/app/components/ui')return {Button:({children,variant,...p})=>React.createElement('button',p,children),Alert:({children})=>React.createElement('div',{role:'alert'},children),LoadingState:({title})=>React.createElement('p',null,title),Card:({children})=>React.createElement('section',null,children),Input:({label,...p})=>React.createElement('label',null,label,React.createElement('input',p))};
 if(['Sidebar','OperationNotificationBell','UserIdentity','BotEnergyBackoffice','EnergyOSLogo','AuthenticatorSettings','ClientPortalContent','PortalWorkspace'].some(n=>name==='@/app/components/'+n))return {__esModule:true,default:()=>React.createElement('span',null,name.split('/').at(-1)),UserWelcome:()=>null};
 if(name.startsWith('@/'))return original.call(this,path.resolve(__dirname,'..',name.slice(2)),parent,main);
 return original.call(this,name,parent,main);
};
const {normalizeAuthContext,isOrganizationAuthContext}=require('../app/lib/auth/organization-context.ts');
const Entry=require('../app/components/AuthenticatedDestination.tsx').default,Login=require('../app/auth/login/page.tsx').default,Mfa=require('../app/auth/mfa/page.tsx').default,Shell=require('../app/components/BackofficeShell.tsx').default,Portal=require('../app/portal/page.tsx').default;
const root=createRoot(document.getElementById('root'));let checks=0,sequence=0;
const ok=(v,m)=>{assert.ok(v,m);checks++;},text=()=>document.body.textContent;
function organization(role='consulta',scope){return {scope,user:{id:'u',email:'reader@example.test'},organizations:[{id:'org',role,role_id:'r'}],currentOrganization:{id:'org',role,permissions:['reports']}};}
const render=async(Component=Entry)=>{routes=[];calls=[];await act(async()=>root.render(React.createElement(Component,{key:++sequence},Component===Shell?React.createElement('p',null,'PRIVATE SHELL'):undefined)));};
(async()=>{try{
 context=organization();ok(normalizeAuthContext(context).scope==='organization','legacy membership explicitly normalized');ok(isOrganizationAuthContext(context),'valid legacy member recognized');
 for(const invalid of [{},{...context,scope:'unknown'},{...context,currentOrganization:{...context.currentOrganization,id:'foreign'}},{...context,organizations:[]},{...context,currentOrganization:{...context.currentOrganization,permissions:null}}]){assert.throws(()=>normalizeAuthContext(invalid));checks++;}
 context=organization();api=async()=>({organizationId:'org',audience:'client'});await render(Login);ok(routes.join()==='/portal'&&!text().includes('Fazer login'),'authenticated legacy client login opens portal without dashboard race');ok(calls.length===1&&calls[0][1].cache==='no-store','server checks client audience without cache');
 context=organization('consulta','organization');await render(Mfa);ok(routes.join()==='/portal','MFA uses same client destination');
 api=async()=>({organizationId:'org',audience:'backoffice'});await render();ok(routes.join()==='/backoffice/dashboard','internal/shared consulta preserves backoffice');
 for(const c of [organization('admin_org','organization'),{...organization('admin_org','organization'),accessMode:'platform_operation'},{scope:'global',user:{id:'owner'},role:'owner',permissions:[]}]){context=c;await render();ok(routes.join()==='/backoffice/dashboard'&&calls.length===0,'internal/Owner destination does not request client audience');}
 context=organization();for(const result of [{organizationId:'foreign',audience:'client'},{organizationId:'org',audience:'invalid'}]){api=async()=>result;await render();ok(!routes.length&&text().includes('contexto de acesso mudou'),'invalid audience or organization cannot navigate');}
 api=async()=>{throw new Error('Acesso revogado');};await render();ok(!routes.length&&text().includes('Acesso revogado'),'revoked access shows retry instead of backoffice fallback');
 api=async()=>({organizationId:'org',audience:'client'});await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Conferir acesso novamente').click());ok(routes.join()==='/portal','retry revalidates the server audience');
 let release;api=()=>new Promise(r=>release=r);context=organization();await render();const previousRelease=release;
 context={...organization(),user:{id:'other'},organizations:[{id:'other-org',role:'consulta'}],currentOrganization:{id:'other-org',role:'consulta',permissions:[]}};api=async()=>({organizationId:'other-org',audience:'backoffice'});await act(async()=>root.render(React.createElement(Entry,{key:++sequence})));routes=[];await act(async()=>previousRelease({organizationId:'org',audience:'client'}));ok(!routes.length,'late previous identity response cannot redirect');
 context=organization();api=async()=>({organizationId:'org',audience:'client'});await render(Shell);ok(routes.join()==='/portal'&&!text().includes('PRIVATE SHELL')&&!text().includes('Sidebar'),'direct legacy client backoffice never renders administrative shell');
 api=async()=>({organizationId:'org',audience:'backoffice'});await render(Shell);ok(text().includes('PRIVATE SHELL'),'internal consulta keeps allowed shell');
 await render(Portal);ok(text().includes('PortalWorkspace')&&!text().includes('exige perfil'),'legacy client eligible for portal content, backend still validates customer');
 authStatus='mfa_required';context=null;await render(Login);ok(routes.join()==='/auth/mfa'&&!text().includes('Fazer login'),'login MFA challenge cannot redirect to dashboard');
 await render(Mfa);ok(text().includes('AuthenticatorSettings')&&!routes.length,'MFA challenge stays available');
 authStatus='unauthenticated';await render(Login);ok(text().includes('Fazer login')&&!routes.length,'signed out sees login');
 login=async()=>{authCalls++;authStatus='authenticated';context=organization();root.render(React.createElement(Login,{key:sequence}));};api=async()=>({organizationId:'org',audience:'client'});await render(Login);
 await act(async()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));ok(authCalls===1&&routes.join()==='/portal','credential submission delegates sole redirect to validated destination');
 console.log(checks+' portal login regression checks passed');
}finally{await act(async()=>root.unmount());dom.window.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
