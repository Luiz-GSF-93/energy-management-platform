/* Real component, isolated DOM, read-only API double. */
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const {JSDOM}=require('jsdom');const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});
for(const k of ['window','document','HTMLElement','HTMLSelectElement','HTMLDialogElement','Event','MouseEvent'])global[k]=dom.window[k];
HTMLDialogElement.prototype.showModal=function(){this.open=true;};HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new Event('close'));};
global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file);
let pending=[],calls=[];const original=Module._load;Module._load=function(name,parent,main){if(name==='@/app/lib/api/client')return {apiRequest:(url,options)=>{assert.equal(options,undefined);calls.push(url);return new Promise((resolve,reject)=>pending.push({resolve,reject}));}};return original.call(this,name,parent,main);};
const Component=require('../app/backoffice/documents/OcrLayoutEvidence.tsx').default;
const f={text:'0,12345678',decimal:'0.12345678',confidence:null,pages:[1],issues:['MISSING_CONFIDENCE']};
const e={name:'CPFL Paulista · Grupo A',version:'cpfl-paulista-a@1.0.0',layoutId:'cpfl-paulista-a',status:'IN_HOMOLOGATION',canImport:false,reviewMessage:'Cobertura não é precisão.',issues:[],financialReconciliation:'REVIEW_REQUIRED',columns:[['grossRate','Tarifa com tributos']],coverage:[{label:'Colunas',mapped:11,expected:11}],library:[{id:'cpfl',name:'CPFL Paulista',version:'1.0.0',status:'SAMPLE_VALIDATED',scope:'Teste',pending:['Conferir PDF']},{id:'neo',name:'Neoenergia A4',version:null,status:'PLANNED',scope:'Próximo',pending:['Amostras']}],fields:[{name:'customer',label:'Empresa',value:{...f,text:'<img src=x onerror=alert(1)>'},source:'documents[0]'}],operations:[{source:'tables[0].row[1]',row:1,component:'TUSD_ENERGY',period:'OFF_PEAK',role:'CHARGE',fields:{grossRate:f},issues:['FIELD_REVIEW_REQUIRED'],arithmetic:{state:'NOT_VERIFIABLE',differenceCents:null}}],blocks:[]};
const root=createRoot(document.getElementById('root'));
(async()=>{try{await act(async()=>root.render(React.createElement(Component,{evidence:e})));
assert.ok(document.body.textContent.includes('conferências e integrações atuais'));
await act(async()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Conferir layout e biblioteca').click());
assert.ok(document.querySelector('dialog').open);assert.ok(document.body.textContent.includes('Fora ponta'));assert.ok(document.body.textContent.includes('não informada'));assert.ok(document.body.textContent.includes('0,12345678'));assert.ok(!document.querySelector('img'));assert.ok(document.body.textContent.includes('Planejado'));assert.ok(!document.body.textContent.includes('100%'));assert.ok(document.body.textContent.includes('Fluxo validado em amostra'));
await act(async()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Fechar layout').click());assert.ok(!document.querySelector('dialog').open);assert.equal(calls.length,0);await act(async()=>root.unmount());console.log('Layout library: 10 checks passed');}catch(e){console.error(e);process.exitCode=1;}finally{dom.window.close();}})();
