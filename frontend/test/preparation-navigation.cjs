/* Isolated DOM: real tariff memory and preparation screen, no production writes. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const {JSDOM}=require('jsdom');const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});
for(const k of ['window','document','HTMLElement','HTMLSelectElement','Event','MouseEvent'])global[k]=dom.window[k];global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file);

let parameterRows=[];let calls=[],result={unit:{id:'u',name:'Unidade'},month:'2026-10',period:{start:'2026-10-01',end:'2026-10-31'},checkedAt:'2026-09-01T12:00:00Z',counts:{blockers:2,reviews:0,approvedParameters:0},findings:[{code:'TAX_MISSING:ACL:ICMS',section:'Tributos',severity:'BLOCKER',message:'Informe ICMS'},{code:'DRAFT_PARAMETERS',section:'Parâmetros',severity:'REVIEW',message:'Aprovar rascunhos'}],catalog:[],suppliers:[],notChecked:[]};
const ui={Button:({children,variant,...p})=>React.createElement('button',{'data-variant':variant,...p},children),Input:({label,...p})=>React.createElement('label',null,label,React.createElement('input',p)),Card:({title,children})=>React.createElement('section',null,React.createElement('h2',null,title),children),Alert:({children})=>React.createElement('div',{role:'alert'},children)};
const original=Module._load;Module._load=function(name,parent,main){if(name==='@/app/components/ui')return ui;if(name==='@/app/providers')return {useAuth:()=>({hasPermission:()=>true})};if(name==='@/app/lib/api/client')return {apiRequest:async(url,options)=>{calls.push({url,options});return url.includes('preparation?')?result:url==='/api/v1/calculation-parameters'?parameterRows:{rows:[],canValidate:false};}};if(name.startsWith('@/app/'))return original.call(this,path.resolve(__dirname,'..',name.slice(2)),parent,main);return original.call(this,name,parent,main);};
const {correctionTarget}=require('../app/backoffice/contracts/preparation-navigation.ts'),Preparation=require('../app/backoffice/contracts/CalculationPreparation.tsx').default,Costs=require('../app/backoffice/contracts/MonthlyCosts.tsx').default,Inputs=require('../app/backoffice/contracts/MonthlyInputs.tsx').default;
const root=createRoot(document.getElementById('root'));let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;};const base={customerId:'c',unitId:'u',month:'2026-10'},units=[{id:'u',customer_id:'c',name:'Unidade',consumer_unit_number:'001'}];
(async()=>{try{
for(const [section,tab] of Object.entries({'Medições':'monthly','Custos mensais':'costs','Unidade':'distributor','Parâmetros':'parameters','Tributos':'parameters','Bases tributárias':'parameters','Fornecedor':'supply','Preços':'supply','Volumes':'supply','Honorários':'management','Custos adicionais':'services'}))ok(correctionTarget({section,code:'X'},base).tab===tab,'destination '+section);
ok(correctionTarget({section:'Desconhecido',code:'X'},base)===null,'unknown has no invented destination');
let target=correctionTarget({section:'Tributos',code:'TAX_MISSING:ACL:ICMS'},base);ok(target.scenario==='ACL'&&target.component==='ICMS'&&target.kind==='TAX','tax filter');
ok(correctionTarget({section:'Parâmetros',code:'DRAFT_PARAMETERS'},base).drafts,'draft filter');ok(correctionTarget({section:'Preços',code:'PRICE_GAP:contract-id'},base).recordId==='contract-id','specific contract');
ok(correctionTarget({section:'Parâmetros',code:'PARAMETER_GAP:ACR/TARIFF/TE/ALL'},base).component==='TE','parameter key');
let opened;await act(async()=>root.render(React.createElement(Preparation,{customerId:'',units,initialContext:base,onCorrect:c=>{opened=c;}})));
let selects=document.querySelectorAll('select');ok(selects[0].value==='u'&&selects[1].value==='10'&&selects[2].value==='2026','return restores consultation');
await act(async()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
await act(async()=>document.querySelector('.preparation-finding-link').click());ok(opened.customerId==='c'&&opened.unitId==='u'&&opened.month==='2026-10'&&opened.component==='ICMS','click resolves actual owner from consolidated view');ok(opened.message==='Informe ICMS','reason retained');
for(const [Component,endpoint] of [[Costs,'costs'],[Inputs,'inputs']]){calls=[];await act(async()=>root.render(React.createElement(Component,{customerId:'c',units,initialContext:base,onDirty:()=>{}})));ok(calls.length===1&&calls[0].url.includes('monthly-'+endpoint+'?consumerUnitId=u&month=2026-10'),'auto load scoped '+endpoint);ok(calls.every(c=>!c.options),'navigation never writes '+endpoint);ok(document.querySelectorAll('select')[0].value==='u','selected unit '+endpoint);}
await act(async()=>root.render(React.createElement('div')));calls=[];await act(async()=>root.render(React.createElement(Costs,{customerId:'other',units,initialContext:base,onDirty:()=>{}})));ok(calls.length===0,'foreign customer not queried');

await act(async()=>root.render(React.createElement('div')));
const Params=require('../app/backoffice/contracts/CalculationParameters.tsx').default;
const param={id:'p',customer_id:'c',consumer_unit_id:'u',kind:'TAX',component_code:'ICMS',label:'ICMS selecionado',scenario:'ACL',time_band:'ALL',measure:'PERCENT',amount_text:'18',treatment:'INSIDE',direction:'DEBIT',base_rule:'',start_date:'2026-01-01',end_date:'2026-12-31',status:'DRAFT',revision:1,source:'Fonte',unit_context:{}};
parameterRows=[{...param,id:'tax-origin',component_code:'PIS',label:'PIS de origem',status:'APPROVED',tax_basis:{version:1,interaction:'INDEPENDENT',items:[]}},{...param,id:'base-tariff',kind:'TARIFF',component_code:'TE',label:'Base aprovada',status:'APPROVED',treatment:'NET',measure:'BRL_KWH',amount_text:'1'},param,{...param,id:'p2',scenario:'ACR',label:'Outro cenário'},{...param,id:'p3',consumer_unit_id:'other-unit',label:'Outra unidade'}];calls=[];
await act(async()=>root.render(React.createElement(Params,{customerId:'c',units,initialContext:target,onDirty:()=>{}})));
ok(document.body.textContent.includes('ICMS selecionado')&&!document.body.textContent.includes('Outro cenário')&&!document.body.textContent.includes('Outra unidade'),'parameter list scoped by unit scenario and tax');
ok(!document.querySelector('form'),'existing parameters shown before new form');
await act(async()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Cadastrar parâmetro faltante').click());
const val=label=>Array.from(document.querySelectorAll('label')).find(l=>l.firstChild?.textContent===label)?.querySelector('select')?.value;
ok(val('Unidade do parâmetro')==='u'&&val('Categoria do parâmetro')==='TAX','missing form context');
ok(calls.every(c=>!c.options),'opening correction creates no record');
const rule=()=>Array.from(document.querySelectorAll('label')).find(l=>l.firstChild?.textContent==='Regra para esta unidade e vigência')?.querySelector('select');
const change=async(el,value)=>{await act(async()=>{el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));});};
ok(rule()?.value==='','no independent rule selected automatically');
await change(rule(),'INDEPENDENT');ok(rule().value==='INDEPENDENT','explicit independent rule selected');
const rubric=Array.from(document.querySelectorAll('label')).find(l=>l.textContent.startsWith('Base aprovada'))?.querySelector('select');
await change(rubric,'INCLUDE');ok(rule().value==='INDEPENDENT','changing base preserves explicit rule');
await change(rule(),'');ok(rule().value===''&&rubric.value==='INCLUDE','clearing interaction preserves rubric');
await change(rule(),'INDEPENDENT');const scenario=Array.from(document.querySelectorAll('label')).find(l=>l.firstChild?.textContent==='Cenário').querySelector('select');await change(scenario,'ACR');ok(rule().value==='','changing scenario clears interaction and base');
await change(scenario,'ACL');await change(rule(),'SEQUENTIAL');ok(document.body.textContent.includes('Tributos que integram esta base'),'sequential source selector visible');
const origin=()=>Array.from(document.querySelectorAll('label')).find(l=>l.textContent.startsWith('PIS de origem'))?.querySelector('input[type=checkbox]');ok(origin()&&!origin().checked,'approved origin available and never preselected');await act(async()=>origin().click());ok(origin().checked,'explicit source selected');await change(rule(),'INDEPENDENT');await change(rule(),'SEQUENTIAL');ok(!origin().checked,'mode change clears old tax references');ok(calls.every(c=>!c.options),'composing form sends no writes before save');
console.log(checks+' preparation navigation checks passed');
}finally{await act(async()=>root.unmount());dom.window.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
