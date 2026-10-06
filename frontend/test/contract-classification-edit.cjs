const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const {JSDOM}=require('jsdom'),dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});
for(const k of ['window','document','HTMLElement','HTMLFormElement','HTMLSelectElement','FormData','Event'])global[k]=dom.window[k];
window.scrollTo=()=>{};global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file);
let calls=[],fail=false;
const ui={Button:({children,variant,...p})=>React.createElement('button',{type:'button',...p},children),Input:({label,...p})=>React.createElement('label',null,label,React.createElement('input',p)),Card:({title,children})=>React.createElement('section',null,React.createElement('h2',null,title),children),Alert:({children})=>React.createElement('div',{role:'alert'},children)};
const original=Module._load;Module._load=function(name,parent,main){if(name==='./DemandPeriods')return {__esModule:true,default:()=>null};if(name==='@/app/components/ui')return ui;if(name==='@/app/providers')return {useAuth:()=>({hasPermission:()=>true})};if(name==='@/app/lib/api/client')return {apiRequest:async(url,options)=>{calls.push({url,options});if(fail)throw Error('Falha simulada');return {id:'u'};}};return original.call(this,name,parent,main);};
const Distributor=require('../app/backoffice/contracts/Distributor.tsx').default,root=createRoot(document.getElementById('root'));
let checks=0;const ok=v=>{assert.ok(v);checks++;};
(async()=>{try{
 for(const [n,combo] of [[false,true,true],[true,true,false],[null,null,null]].entries()){
 const unit={id:'u',customer_id:'c',name:'Unidade',consumer_unit_number:'001',distributor:'D',tariff_group:'A',tariff_subgroup:'A4',tariff_modality:'GREEN',edit_version:7,free_market:combo[0],has_gd:combo[1],has_bess:combo[2]};
 await act(async()=>root.render(React.createElement(Distributor,{key:n,customerId:'c',units:[unit],customers:[{id:'c',company_name:'Cliente'}],initialContext:{customerId:'c',unitId:'u'},onUnits:()=>{},onDirty:()=>{}})));
 for(const [i,key] of ['freeMarket','hasGd','hasBess'].entries())ok(document.querySelector('[name="'+key+'"]').value===(combo[i]===null?'':String(combo[i])));
 document.querySelector('[name="reason"]').value='Conferência da instalação';fail=true;
 const submit=()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await act(async()=>submit());
 const first=calls.at(-1);ok(first.options.method==='PUT'&&first.url==='/api/v1/consumer-units/u');ok(first.options.body.expectedVersion===7&&first.options.body.reason==='Conferência da instalação');
 for(const [i,key] of ['freeMarket','hasGd','hasBess'].entries())ok(first.options.body.changes[key]===combo[i]);
 fail=false;await act(async()=>submit());ok(calls.at(-1).options.body.requestId===first.options.body.requestId);
 }
 console.log('Independent classification edit checks passed:',checks);
 }finally{await act(async()=>root.unmount());dom.window.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
