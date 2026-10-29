// Actual panels in an isolated DOM; no production data or writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const {JSDOM}=require('jsdom'),dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid/portal'});
for(const k of ['window','document','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Event'])global[k]=dom.window[k];global.IS_REACT_ACT_ENVIRONMENT=true;global.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const calls=[],unitIds=['a','b','c'],identity={organizationId:'org',customerId:'customer',companyName:'Empresa sintética',units:unitIds.map(id=>({id,name:'Unidade '+id,installation:'UC-'+id,address:'Endereço de teste '+id}))},amounts={acr:'200.00',aclBeforeFees:'90.00',totalFees:'10.00',aclAfterFees:'100.00',savingsBeforeFees:'110.00',savingsAfterFees:'100.00',savingsPercent:'50.00'};
async function api(url,options){calls.push([url,options]);const q=new URL(url,'https://test.invalid').searchParams,ids=q.get('unitIds')?.split(',')??unitIds,year=q.get('year')??'2026';
 if(url.endsWith('/identity'))return identity;
 if(url.includes('/financial-details?'))return {organizationId:'org',customerId:'customer',from:q.get('from'),to:q.get('to'),rows:[],consolidated:null,corrections:[],correctionTotal:'0.00'};
 if(url.includes('/financial?'))return {organizationId:'org',audience:'client',customerId:'customer',period:{from:q.get('from'),to:q.get('to'),customerId:'customer'},updatedAt:'2026-10-29T12:00:00Z',publicationCount:1,customerCount:1,unitMonthCount:ids.length,totals:amounts,months:[],rows:[{id:'pub',customerId:'customer',customerName:'Empresa sintética',month:'2026-04',version:1,payloadHash:'a'.repeat(64),publishedAt:'2026-10-29T12:00:00Z',publicationNote:'',units:identity.units.filter(u=>ids.includes(u.id)),reservations:[],amounts}],disclosure:'Fixture'};
 if(url.includes('/energy-prices?'))return {organizationId:'org',audience:'client',customerId:'customer',year:Number(year),units:identity.units.filter(u=>ids.includes(u.id)).map(u=>({...u,customerId:'customer',customerName:'Empresa sintética'})),baselines:[],months:[],acrAverage:null,aclAverage:null,indicative:{value:null,reason:'Sem referência',notice:''},footer:'Fixture',disclosure:'Fixture',canPublish:false};
 if(url.includes('/energy-forecasts'))return {rows:[],currentPlanning:[],consolidatedAnnual:null};
 if(url.includes('/reports/client/units'))return {units:identity.units};
 if(url.endsWith('/reports/client'))return {state:'READY',answer:'Resposta sintética',evidence:[]};
 throw Error('Unexpected '+url);
}
const original=Module._load;Module._load=function(name,parent,main){
 if(name.endsWith('.module.css'))return {};
 if(name==='@/app/lib/api/client'||name==='@/app/lib/api')return {apiRequest:api};
 if(name==='@/app/providers')return {useAuth:()=>({hasPermission:()=>true,context:{scope:'organization',user:{id:'reader'},currentOrganization:{id:'org',permissions:[]}}})};
 if(name==='next/link')return {__esModule:true,default:({children,...p})=>React.createElement('a',p,children)};
 if(name==='./ui'||name==='@/app/components/ui')return {Button:({children,variant,...p})=>React.createElement('button',p,children),Card:({children,title})=>React.createElement('section',null,title,children),Alert:({children})=>React.createElement('p',{role:'alert'},children)};
 if(name.startsWith('@/'))return original.call(this,path.resolve(__dirname,'..',name.slice(2)),parent,main);
 return original.call(this,name,parent,main);
};
const Scope=require('../app/components/PortalUnitScope.tsx').default,Financial=require('../app/components/PublishedFinancialDashboard.tsx').default,Prices=require('../app/components/EnergyPriceDashboard.tsx').default,Forecast=require('../app/components/PublishedForecastDashboard.tsx').default,Bot=require('../app/components/BotEnergyReports.tsx').default,root=createRoot(document.getElementById('root'));
const content=React.createElement(React.Fragment,null,React.createElement(Financial,{organizationId:'org',organizationName:'Org',audience:'client'}),React.createElement(Prices,{organizationId:'org',audience:'client'}),React.createElement(Forecast),React.createElement(Bot,{audience:'client'}));
const latest=segment=>calls.filter(([url])=>url.includes(segment)).at(-1);
const expectScope=ids=>{for(const segment of ['/financial?','/financial-details?','/energy-prices?','/energy-forecasts'])assert.equal(new URL(latest(segment)[0],'https://test.invalid').searchParams.get('unitIds'),ids,segment);};
(async()=>{try{
 await act(async()=>root.render(React.createElement(Scope,{organizationId:'org'},content)));expectScope('a,b,c');assert(document.body.textContent.includes('UC-a'));
 await act(async()=>document.querySelectorAll('fieldset input[type=checkbox]')[2].click());expectScope('a,b');
 const textarea=document.querySelector('textarea');await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value').set.call(textarea,'Qual a economia consolidada?');textarea.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Perguntar à EVA')).click());assert.equal(latest('/reports/client')[1].body.unitIds,'a,b');
 await act(async()=>document.querySelectorAll('fieldset input[type=checkbox]')[1].click());expectScope('a');assert(document.body.textContent.includes('Endereço de teste a'));assert.equal(document.querySelector('fieldset input[type=checkbox]').disabled,true);assert(!document.body.textContent.includes('Resposta sintética'));
 await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Consolidar todas as unidades autorizadas').click());expectScope('a,b,c');
 console.log('PASS global unit selector: all/subset/single, full identity, financial/composition/price/forecast queries, EVA consolidated request and context reset.');
 }finally{await act(async()=>root.unmount());dom.window.close();}})().catch(e=>{console.error(e);process.exitCode=1});
