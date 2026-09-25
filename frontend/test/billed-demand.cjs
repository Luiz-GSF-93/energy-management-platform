/* Isolated DOM: real tariff memory and preparation screen, no production writes. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const {JSDOM}=require('jsdom');const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});
for(const k of ['window','document','HTMLElement','HTMLSelectElement','HTMLInputElement','HTMLTextAreaElement','Event','MouseEvent'])global[k]=dom.window[k];global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file);

let handler=async()=>({rows:[],canValidate:true});let parameterRows=[];let calls=[],result={unit:{id:'u',name:'Unidade'},month:'2026-10',period:{start:'2026-10-01',end:'2026-10-31'},checkedAt:'2026-09-01T12:00:00Z',counts:{blockers:2,reviews:0,approvedParameters:0},findings:[{code:'TAX_MISSING:ACL:ICMS',section:'Tributos',severity:'BLOCKER',message:'Informe ICMS'},{code:'DRAFT_PARAMETERS',section:'Parâmetros',severity:'REVIEW',message:'Aprovar rascunhos'}],catalog:[],suppliers:[],notChecked:[]};
const ui={Button:({children,variant,...p})=>React.createElement('button',{'data-variant':variant,...p},children),Input:({label,...p})=>React.createElement('label',null,label,React.createElement('input',p)),Card:({title,children})=>React.createElement('section',null,React.createElement('h2',null,title),children),Alert:({children})=>React.createElement('div',{role:'alert'},children)};
const original=Module._load;Module._load=function(name,parent,main){if(name==='@/app/components/ui')return ui;if(name==='@/app/providers')return {useAuth:()=>({hasPermission:()=>true})};if(name==='@/app/lib/api/client')return {apiRequest:async(url,options)=>{calls.push({url,options});return handler(url,options);}};if(name.startsWith('@/app/'))return original.call(this,path.resolve(__dirname,'..',name.slice(2)),parent,main);return original.call(this,name,parent,main);};

const Inputs=require('../app/backoffice/contracts/MonthlyInputs.tsx').default;
const root=createRoot(document.getElementById('root'));let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;};
const units=[{id:'u',customer_id:'c',name:'Unidade',consumer_unit_number:'001'}],ctx={customerId:'c',unitId:'u',month:'2026-10'};
const button=t=>Array.from(document.querySelectorAll('button')).find(x=>x.textContent===t);
const label=t=>Array.from(document.querySelectorAll('label')).find(x=>x.textContent===t);
const input=async(t,value)=>{const el=label(t).querySelector('input,textarea');await act(async()=>{const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement:HTMLInputElement;Object.getOwnPropertyDescriptor(proto.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));});};
const toggle=async(s)=>{const el=Array.from(document.querySelectorAll('label')).find(x=>x.textContent.trim()==='Informar demanda faturável '+s).querySelector('input');await act(async()=>el.click());};
(async()=>{try{
 await act(async()=>root.render(React.createElement(Inputs,{customerId:'c',units,initialContext:ctx,onDirty:()=>{}})));
 await act(async()=>button('Novo rascunho mensal').click());ok(!label('Demanda faturável ACL · Única (kW)'),'billing opt in, no default quantity');
 await toggle('ACL');await input('Demanda faturável ACL · Única (kW)','12,5');await input('Fonte e regra da demanda faturável ACL','Fatura p2');
 await toggle('ACR');await input('Demanda faturável ACR · Única (kW)','15');await input('Fonte e regra da demanda faturável ACR','Regra ACR');
 ok(label('Demanda faturável ACL · Única (kW)').querySelector('input').value==='12.5','exact decimal normalization');
 await input('Consumo total (kWh)','100');await input('Fonte e evidência das medições','Relatório');
 let payload;handler=async(url,options)=>{payload=options.body;throw Error('Falha simulada');};
 await act(async()=>document.querySelectorAll('form')[1].dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 ok(payload.consumerUnitId==='u'&&payload.month==='2026-10','same unit and competence');ok(payload.billedDemand.ACL.single==='12.5'&&payload.billedDemand.ACR.single==='15','distinct billing scenarios saved');ok(payload.billedDemand.ACL.source==='Fatura p2','source included');ok(label('Demanda faturável ACR · Única (kW)').querySelector('input').value==='15','failed save preserves input');
 await toggle('ACR');await act(async()=>document.querySelectorAll('form')[1].dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));ok(!payload.billedDemand.ACR&&payload.billedDemand.ACL.single==='12.5','removal is explicit and isolated');
 await act(async()=>root.render(React.createElement('div')));
 const row={id:'m',consumer_unit_id:'u',month:'2026-10',version:1,revision:2,status:'VALIDATED',measurements:{consumptionTotal:'100'},billed_demand:{ACL:{single:'12.5',peak:null,offPeak:null,source:'Fatura original'}},source_reference:'Fonte',notes:'',updated_at:'2026-10-01',validated_at:'2026-10-01',validated_by:'a'};
 handler=async()=>({rows:[row],canValidate:true});await act(async()=>root.render(React.createElement(Inputs,{customerId:'c',units,initialContext:ctx,onDirty:()=>{}})));
 ok(document.body.textContent.includes('Fatura original'),'validated details show evidence');await act(async()=>button('Criar versão corrigida').click());ok(label('Demanda faturável ACL · Única (kW)').querySelector('input').value==='12.5','correction copies prior explicit fields');await input('Demanda faturável ACL · Única (kW)','14');ok(row.billed_demand.ACL.single==='12.5','editing correction preserves prior snapshot');
 console.log(checks+' billed demand interface checks passed');
}finally{await act(async()=>root.unmount());dom.window.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
