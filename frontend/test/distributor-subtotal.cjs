/* Isolated DOM validation; no production records. */
const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {JSDOM}=require('jsdom');const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});
for(const k of ['window','document','HTMLElement','Event'])global[k]=dom.window[k];global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file);
const Component=require('../app/backoffice/contracts/DistributorSubtotal.tsx').default;
const ready={scenario:'ACR',status:'AVAILABLE',tariffs:'100.01',taxes:'18.00',subtotal:'118.01',entries:[{id:'t',revision:2,kind:'TAX',label:'ICMS',amount:'18.00',source:'Fonte aprovada'}],blockers:[]};
const data={formulaVersion:'distributor-subtotal-1.0',rounding:'SUM_ROUNDED_LINES',scenarios:[ready,{scenario:'ACL',status:'BLOCKED',tariffs:null,taxes:null,subtotal:null,entries:[],blockers:['Revise a base tributária.']}],warnings:['Consulta preliminar.']};
const root=createRoot(document.getElementById('root'));let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;};const render=async d=>act(async()=>root.render(React.createElement(Component,{data:d})));const text=()=>document.body.textContent;
(async()=>{try{
 await render(data);ok(text().includes('R$ 118,01'),'server subtotal');ok(text().includes('R$ 100,01')&&text().includes('R$ 18,00'),'breakdown');ok(text().includes('Revise a base tributária.'),'blocker retained');ok(text().includes('Aguardando revisão'),'blocked scenario');ok(text().includes('Fonte aprovada')&&text().includes('Revisão 2'),'auditable source');ok(text().includes('Fornecedor, custos adicionais e honorários permanecem separados'),'scope visible');
 await render(undefined);ok(text().includes('ainda não está disponível')&&!text().includes('R$ 0,00'),'rolling API response');
 await render({...data,scenarios:[{...ready,status:'BLOCKED'}]});ok(!text().includes('R$ 118,01'),'blocked stale amount hidden');
 await render({...data,scenarios:[{...ready,blockers:['pendente']}]});ok(!text().includes('R$ 118,01'),'contradictory ready state blocked');
 await render({...data,scenarios:[{...ready,subtotal:'NaN'}]});ok(!text().includes('NaN'),'malformed amounts suppressed');
 await render({...data,scenarios:[{...ready,tariffs:'0.00',taxes:'0.00',subtotal:'0.00'}]});ok(text().includes('R$ 0,00'),'explicit zero shown');
 await render({...data,scenarios:[ready,{...ready}]});ok(!text().includes('R$ 118,01'),'duplicate scenarios not chosen arbitrarily');
 console.log(checks+' distributor subtotal interface checks passed');
}finally{await act(async()=>root.unmount());dom.window.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
