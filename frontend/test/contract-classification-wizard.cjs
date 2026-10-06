/* Exercises the real wizard in an isolated DOM with an in-memory API. */
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const {JSDOM}=require('jsdom');const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});
for(const k of ['window','document','HTMLElement','HTMLInputElement','HTMLSelectElement','HTMLTextAreaElement','HTMLFormElement','FormData','Event','MouseEvent'])global[k]=dom.window[k];
// jsdom does not implement native dialog methods; real browser behavior is checked separately.
dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file);
const {entryIssues,entryPayload}=require('../../backend/dist/modules/contracts/services/entry-drafts.js');
let rows=[],requests=0,failSave=false;const clone=v=>JSON.parse(JSON.stringify(v));
const apiRequest=async(url,options)=>{if(!options)return clone(rows);requests++;if(failSave)throw Error('Falha simulada: campos preservados');const b=options.body,old=rows.find(r=>url.endsWith('/'+r.id));const p=entryPayload(b.kind,b.customerId,b.payload),issues=[...entryIssues(b.kind,p),...b.deferredSteps.map(n=>'step:'+n)];const r={id:old?.id||'entry-'+requests,customer_id:b.customerId,kind:b.kind,payload:clone(p),issues,status:issues.length?'INCOMPLETE':'DRAFT',revision:(old?.revision||0)+1,deferred_steps:b.deferredSteps,updated_at:new Date().toISOString()};rows=[r,...rows.filter(x=>x.id!==r.id)];return clone(r);};
const ui={Button:({children,variant,...p})=>React.createElement('button',{type:'button','data-variant':variant,...p},children),Card:({title,children})=>React.createElement('section',null,React.createElement('h2',null,title),children),Alert:({children})=>React.createElement('div',{role:'alert'},children),Input:({label,...p})=>React.createElement('label',null,label,React.createElement('input',p))};
const original=Module._load;Module._load=function(name,parent,main){if(name==='@/app/components/ui')return ui;if(name==='@/app/providers')return {useAuth:()=>({hasPermission:()=>true})};if(name==='@/app/lib/api/client')return {apiRequest};return original.call(this,name,parent,main);};
const Wizard=require('../app/backoffice/contracts/EntryWizard.tsx').default;
const a='00000000-0000-4000-8000-000000000001';const props={customers:[{id:a,company_name:'Cliente de teste'}],units:[{id:a,customer_id:a,name:'Unidade de teste',consumer_unit_number:'1'}],filterCustomer:a,onDirty:()=>{},onActive:()=>{},onRegistered:()=>{},requestStart:fn=>fn()};
const root=createRoot(document.getElementById('root'));let checks=0;const ok=v=>{assert.ok(v);checks++;};const visible=e=>!e.closest('[hidden]');
const click=async(text)=>{const button=Array.from(document.querySelectorAll('button')).find(b=>b.textContent===text&&visible(b));assert.ok(button,'Button '+text);await act(async()=>button.click());};
const field=(label,hidden=false)=>{const l=Array.from(document.querySelectorAll('label')).find(e=>e.firstChild?.textContent===label&&(hidden||visible(e)));assert.ok(l,'Field '+label);return l.querySelector('input,select,textarea');};
const fill=async(label,value)=>{const e=field(label);const proto=e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;await act(async()=>{Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));});};
(async()=>{try{
 await act(async()=>root.render(React.createElement(Wizard,props)));

 for(const combo of [[false,true,true],[true,true,false],[null,null,null]]){
 rows=[];
 await click('Inserir novo');await fill('Cliente em operação',a);await fill('Tipo de cadastro','distributor');await click('Próximo');
 await fill('Nome da unidade *','Unidade');await fill('Código da instalação / unidade *','001');await fill('Distribuidora *','D');await click('Próximo');
 await fill('Grupo tarifário *','A');await fill('Subgrupo tarifário *','A4');await fill('Modalidade tarifária *','GREEN');
 for(const [i,label] of ['Ambiente de contratação','Geração Distribuída (GD)','Armazenamento em baterias (BESS)'].entries())await fill(label,combo[i]===null?'':String(combo[i]));
 await click('Anterior');await click('Próximo');ok(field('Geração Distribuída (GD)').value===(combo[1]===null?'':String(combo[1])));
 await click('Próximo');await click('Próximo');await click('Próximo');await click('Salvar lançamento');
 for(const [i,key] of ['freeMarket','hasGd','hasBess'].entries())ok(rows[0].payload[key]===(combo[i]===null?undefined:combo[i]));
 ok(rows[0].status==='DRAFT');await click('Continuar preenchimento');await click('Próximo');ok(field('Armazenamento em baterias (BESS)').value===(combo[2]===null?'':String(combo[2])));
 await click('Próximo');await click('Próximo');await click('Próximo');failSave=true;await click('Salvar lançamento');ok(document.body.textContent.includes('Falha simulada'));failSave=false;await click('Salvar lançamento');
 }
 console.log('Independent classification wizard checks passed:',checks);
 }finally{await act(async()=>root.unmount());dom.window.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
