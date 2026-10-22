// Isolated React/UI integration with synthetic published values; zero external calls.
process.env.NEXT_PUBLIC_CLIENT_PORTAL_LICENSES_ENABLED='true';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),Module=require('node:module'),ts=require('typescript');
const {JSDOM}=require('jsdom'),dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid/portal'});
for(const k of ['window','document','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','Event','MouseEvent'])global[k]=dom.window[k];global.IS_REACT_ACT_ENVIRONMENT=true;
// jsdom has no viewport observer; browser QA covers avatar visibility separately.
global.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
const navigation=[];
const unit='00000000-0000-4000-8000-000000000010',stylesheets=new Map(),router={replace:p=>navigation.push(p),push:()=>{}},amounts={acr:'1000.00',aclBeforeFees:'650.00',totalFees:'50.00',aclAfterFees:'700.00',savingsBeforeFees:'350.00',savingsAfterFees:'300.00',savingsPercent:'30.00'};
let license={enabled:true,modules:['reports','energy_prices','bot'],starts:'2026-10-19',ends:'2026-10-26'},brandOrg='org',apiCalls=[],responseState='NO_EVIDENCE';
const context={scope:'organization',user:{id:'reader'},organizations:[{id:'org',role:'consulta'}],currentOrganization:{id:'org',name:'Organização modelo',role:'consulta',permissions:[]}};
const insight={publicationId:'pub',sourceHash:'a'.repeat(64),customerId:'customer',unitId:unit,name:'Unidade demonstrativa',month:'2026-09',composition:[{key:'distributor',label:'Fatura da distribuidora',amount:'500.00',percent:'71.42',offset:'0.00'},{key:'supplier',label:'Energia do fornecedor',amount:'150.00',percent:'21.42',offset:'71.42'},{key:'fees',label:'Honorários da gestão',amount:'50.00',percent:'7.16',offset:'92.84'}],compositionNotice:'Componentes conciliados.',indicators:[{key:'REACTIVE_EXCESS:0',kind:'REACTIVE_EXCESS',label:'Reativo excedente faturado',amount:'15.00',recommendation:'Consulte seu consultor e a equipe técnica.',notice:'Custo já incluído na fatura.'}],indicatorNotice:'Ausência de dados não é zero.'};
async function api(url,opt){apiCalls.push([url,opt]);const q=new URL(url,'https://test.invalid').searchParams,from=q.get('from'),to=q.get('to');
 if(url==='/api/v1/portal/license')return license;
 if(url==='/api/v1/organization-branding')return {organizationId:brandOrg,name:'Organização modelo',revision:0,logo:''};
 if(url.startsWith('/api/v1/portal/financial?'))return {organizationId:'org',audience:'client',customerId:'customer',period:{from,to,customerId:'customer'},updatedAt:'2026-10-19T12:00:00Z',publicationCount:1,customerCount:1,unitMonthCount:1,totals:amounts,months:[{month:'2026-09',publicationCount:1,totals:amounts}],charts:[{month:'2026-09',acr:'1000.00',acl:'700.00',savings:'300.00',cumulative:'300.00',widths:{acr:'100.00',acl:'70.00',savings:'30.00',cumulative:'30.00'}}],rows:[{id:'pub',customerId:'customer',customerName:'Cliente demonstrativo',month:'2026-09',version:1,payloadHash:'a'.repeat(64),publishedAt:'2026-10-19T12:00:00Z',publicationNote:'',units:[{id:unit,name:'Unidade demonstrativa'}],reservations:[],amounts}],disclosure:'Valores sintéticos de teste.'};
 if(url.startsWith('/api/v1/portal/financial-details?'))return {organizationId:'org',customerId:'customer',from,to,rows:[insight],consolidated:insight.composition,corrections:[],correctionTotal:'0.00'};
 if(url.startsWith('/api/v1/portal/energy-prices?'))return {organizationId:'org',audience:'client',customerId:'customer',year:Number(q.get('year')),units:[{id:unit,name:'Unidade demonstrativa',customerId:'customer',customerName:'Cliente demonstrativo'}],baselines:[],months:Array.from({length:12},(_,i)=>({month:'2026-'+String(i+1).padStart(2,'0'),acr:i===8?'400.00':null,acl:i===8?'150.00':null,pld:i===8?'120.00':null,scorePercent:i===8?'62.50':null,taxBasis:'NET'})),acrAverage:null,aclAverage:null,indicative:{value:null,notice:'Sem recomendação de compra.',reason:'Fixture sintética.'},canPublish:false,disclosure:'Dados sintéticos, não são resultados reais.',footer:'Fontes sintéticas para teste visual.'};
 if(url.startsWith('/api/v1/bot-energy/reports/client/units'))return {units:[{id:unit,name:'Unidade demonstrativa'}]};
 if(url==='/api/v1/bot-energy/reports/client')return {state:responseState,message:'Não há fonte suficiente para esta dúvida.'};
 throw Error('Unexpected fixture URL '+url);
}
const original=Module._load;Module._load=function(name,parent,main){
 if(name.endsWith('.module.css')){const file=path.resolve(path.dirname(parent.filename),name),css=fs.readFileSync(file,'utf8'),prefix=path.basename(file,'.module.css').replace(/\W/g,'')+'_',globals=[];const scoped=css.replace(/:global\(([^)]+)\)/g,(_,s)=>{globals.push(s);return 'GLOBALTOKEN'+(globals.length-1);}).replace(/\.([a-zA-Z_][\w-]*)/g,(_,c)=>'.'+prefix+c).replace(/GLOBALTOKEN(\d+)/g,(_,i)=>globals[i]);stylesheets.set(file,scoped);return {__esModule:true,default:new Proxy({},{get:(_,key)=>prefix+String(key)})};}
 if(name.endsWith('.css'))return {};
 if(name==='next/navigation')return {useRouter:()=>router};
 if(name==='next/link'||name==='next/image')return {__esModule:true,default:({children,href,src,priority,...p})=>React.createElement(name==='next/image'?'img':'a',name==='next/image'?{src,...p}:{href,...p},children)};
 if(name==='@/app/providers')return {useAuth:()=>({context,status:'authenticated',logout:()=>{},hasPermission:()=>true})};
 if(name==='@/app/providers/UserEnvironmentProvider')return {useUserEnvironment:()=>({account:{preferences:{theme:'blue'}}})};
 if(name==='@/app/lib/api'||name==='@/app/lib/api/client')return {apiRequest:api};
 if(name==='./client'&&parent.filename.endsWith('portal-licenses.ts'))return {apiRequest:api,ApiError:class extends Error{}};
 if(name==='./UserIdentity')return {__esModule:true,default:()=>React.createElement('span',null,'Luiz · Consulta externa'),UserWelcome:()=>React.createElement('p',null,'Olá, Luiz!')};
 if(name==='./AccountSettings')return {__esModule:true,default:()=>React.createElement('section',null,'Minhas configurações')};
 if(name.startsWith('@/'))return original.call(this,path.resolve(__dirname,'..',name.slice(2)),parent,main);
 return original.call(this,name,parent,main);
};
const Workspace=require('../app/components/PortalWorkspace.tsx').default,Editor=require('../app/components/OrganizationBrandingEditor.tsx').default;
const root=createRoot(document.getElementById('root'));let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;},text=()=>document.body.textContent;
async function render(key,props={}){await act(async()=>root.render(React.createElement(Workspace,{key,...props})));}
(async()=>{try{
 await render('full');ok(document.querySelector('h1').textContent==='Organização modelo','contracting organization has primary identity');ok(text().includes('EnergyOS'),'product brand preserved');
 for(const a of document.querySelectorAll('nav a[href^="#"]'))ok(document.getElementById(a.getAttribute('href').slice(1)),'every visible menu points to mounted licensed content');
 await act(async()=>{window.location.hash='#minhas-faturas';window.dispatchEvent(new Event('hashchange'));});ok(navigation.includes('/portal/invoices'),'legacy invoice notifications route to the dedicated page after hash navigation');window.history.replaceState({},'', '/portal');
 ok(!text().includes('Adesão ACL')&&!text().includes('Previsão de consumo'),'unlicensed menus are not advertised');
 const collapse=document.querySelector('button[aria-label="Recolher menu do Portal"]');await act(async()=>collapse.click());ok(document.querySelector('button[aria-expanded="false"]'),'sidebar collapse works with accessible state');await act(async()=>document.querySelector('button[aria-label="Expandir menu do Portal"]').click());
 ok(text().includes('Economia acumulada após honorários')&&text().includes('30,00%'),'cumulative savings uses supplied aggregate percentage');ok(document.querySelector('figure svg[role="img"]'),'published composition donut is rendered');ok(text().includes('Reativo excedente faturado'),'published reactive cost displayed');
 ok(document.querySelector('textarea').closest('[class*="compose"]'),'EVA textarea receives styled compose layout');ok(!text().includes('Perguntar ao Bot')&&text().includes('Perguntar à EVA'),'client-facing bot label corrected');
 await act(async()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value').set.call(input,'Há desperdício?');input.dispatchEvent(new Event('input',{bubbles:true}));});await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Perguntar à EVA')).click());ok(text().includes('Fale com o consultor'),'unsupported answer directs client to organization consultant');
 license={...license,modules:['reports']};await render('reports');ok(!document.querySelector('#bot-energy')&&!document.querySelector('nav a[href="#bot-energy"]'),'module removal hides content and navigation together');
 await render('settings',{settings:true});ok(text().includes('Minhas configurações'),'portal settings use same shell');ok(document.querySelector('nav a[href="/portal#financeiro"]'),'settings navigation returns to actual portal section');
 await act(async()=>root.render(React.createElement(Editor)));ok(!document.querySelector('input[type="file"]'),'client cannot edit organization branding');
 if(process.env.PORTAL_VISUAL_FIXTURE){license={...license,modules:['reports','energy_prices','bot']};await render('visual');for(const option of document.querySelectorAll('option')){if(option.selected)option.setAttribute('selected','');else option.removeAttribute('selected');}const css=fs.readFileSync(path.join(__dirname,'../app/globals.css'),'utf8')+'\n'+[...stylesheets.values()].join('\n');fs.writeFileSync(process.env.PORTAL_VISUAL_FIXTURE,'<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Portal — dados sintéticos para QA</title><style>'+css+'</style><body>'+document.body.innerHTML+'</body></html>');}
 console.log(checks+' portal identity/navigation/EVA UI checks passed');
}finally{await act(async()=>root.unmount());dom.window.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
