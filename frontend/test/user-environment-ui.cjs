
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),React=require('react');
const {JSDOM}=require(process.env.JSDOM_TEST_MODULE||'jsdom'),{createRoot}=require('react-dom/client');
const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'https://energyos.test'});
global.window=dom.window;global.document=dom.window.document;global.navigator=dom.window.navigator;global.IS_REACT_ACT_ENVIRONMENT=true;
let auth={status:'authenticated',context:{scope:'organization',user:{id:'A'},currentOrganization:{id:'org',role:'operacional'}},refresh:async()=>{},logout:()=>{}};
const reads=[],saved=[];const accountApi={read:()=>new Promise((resolve,reject)=>reads.push({resolve,reject})),save:async p=>{saved.push(p);return {...p,revision:p.revision+1};}};
const defaults={revision:0,theme:'blue',avatar_kind:'initials',emoji:'🙂',photo:'',cep:'',personal_phone:''};
const account=(name,theme='blue')=>({identity:{name,email:'self@example.test',memberships:[]},preferences:{...defaults,theme}});
const cache=new Map();
const mocks={'@/app/providers':{useAuth:()=>auth},'@/app/providers/AuthProvider':{useAuth:()=>auth},'@/app/lib/account':{accountApi},'next/navigation':{useRouter:()=>({replace:p=>routes.push(p)})},'@/app/components/SessionNotice':{default:()=>null},'@/app/lib/api/client':{apiRequest:async()=>[]},'@/app/lib/auth/session':{session:{getAccessToken:()=>null,clear:()=>{},getOrganizationSession:()=>null}},'@/app/lib/api':{ApiError:class ApiError extends Error{constructor(m,s){super(m);this.status=s;}},getAuthContext:async()=>{},getPlatformContext:async()=>{}}};
const routes=[];
function load(relative){const filename=path.resolve(relative);if(cache.has(filename))return cache.get(filename);const m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));m.require=id=>{if(mocks[id])return mocks[id];if(id.startsWith('@/')){let p=path.resolve('app',id.slice(6));for(const ext of ['.tsx','.ts','/index.ts'])if(fs.existsSync(p+ext))return load(p+ext);}return require(id);};cache.set(filename,m.exports);m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);cache.set(filename,m.exports);return m.exports;}
const {UserEnvironmentProvider,useUserEnvironment}=load('app/providers/UserEnvironmentProvider.tsx');
let environment;
function Probe(){environment=useUserEnvironment();return React.createElement('p',{},environment.account?.identity.name||environment.error||'empty');}
const rootNode=createRoot(document.getElementById('root'));
const render=async()=>{await React.act(async()=>{rootNode.render(React.createElement(UserEnvironmentProvider,{},React.createElement(Probe)));});await React.act(async()=>{await new Promise(r=>setTimeout(r,15));});};
let checks=0;const check=v=>{assert.ok(v);checks++;};
(async()=>{
 await render();check(reads.length===1);
 auth={...auth,context:{...auth.context,user:{id:'B'}}};await render();check(reads.length===2);
 await React.act(async()=>reads[0].resolve(account('Nome A','graphite')));check(!document.body.textContent.includes('Nome A'));check(document.documentElement.dataset.energyosTheme==='blue');
 await React.act(async()=>reads[1].resolve(account('Nome B')));check(document.body.textContent.includes('Nome B'));
 await React.act(async()=>environment.save({...defaults,theme:'light'}));check(saved.length===1);check(environment.account.preferences.revision===1);check(document.documentElement.dataset.energyosTheme==='light');
 auth={status:'unauthenticated',context:null};await render();check(!document.body.textContent.includes('Nome B'));check(document.documentElement.dataset.energyosTheme==='blue');
 auth={status:'authenticated',context:{scope:'organization',user:{id:'C'},currentOrganization:{id:'org',role:'consulta'}}};await render();await React.act(async()=>reads[2].reject(new Error('registry unavailable')));check(document.body.textContent.includes('Não foi possível'));check(!document.body.textContent.includes('Nome B'));
 await React.act(async()=>rootNode.unmount());
 const protectedNode=createRoot(document.getElementById('root'));
 mocks['@/app/components/ui']={LoadingState:()=>React.createElement('p',{},'loading'),Button:()=>null,ErrorState:()=>null};
 const Protected=load('app/components/ProtectedRoute.tsx').default;
 auth={status:'mfa_required'};await React.act(async()=>protectedNode.render(React.createElement(Protected,{},React.createElement('p',{},'business private'))));check(routes.includes('/auth/mfa'));check(!document.body.textContent.includes('business private'));
 auth={status:'authenticated'};await React.act(async()=>protectedNode.render(React.createElement(Protected,{},React.createElement('p',{},'business private'))));check(document.body.textContent.includes('business private'));
 await React.act(async()=>protectedNode.unmount());
 const {resolveLoginContext}=load('app/lib/auth/resolve-context.ts');let recovery=0;const ErrorType=mocks['@/app/lib/api'].ApiError;
 await assert.rejects(()=>resolveLoginContext({context:async()=>{throw new ErrorType('MFA_REQUIRED',403)},platform:async()=>{recovery++;},clearOperation:()=>{recovery++;},organizations:async()=>[],switchOrganization:async()=>{},forbidden:e=>e instanceof ErrorType&&e.status===403&&e.message!=='MFA_REQUIRED'},true),/MFA_REQUIRED/);checks++;check(recovery===0);
 console.log('Personal environment / logout / stale response / MFA route:',checks,'checks passed');
})().catch(e=>{console.error(e);process.exit(1)});
