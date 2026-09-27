const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText,f);
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),C=require('../app/backoffice/documents/OcrDemandPreview.tsx').default;
const base={message:'Conferência',measured:[],billed:[],contracted:{message:'Conferir'},unused:{message:'Conferir'}};
const render=r=>renderToStaticMarkup(React.createElement(C,{evidence:{...base,reconciliation:r}}));
let html=render({state:'MATCH',contracted:'500',billedTotal:'500',difference:'0',message:'Coincidência aritmética',sources:[]});assert.ok(html.includes('Soma compatível'));assert.ok(html.includes('500 kW'));assert.ok(html.includes('0 kW'));
html=render({state:'DIFFERENCE',contracted:'500',billedTotal:'499.5',difference:'-0.5',message:'Conferir',sources:[]});assert.ok(html.includes('Diferença a conferir'));assert.ok(html.includes('-0,5 kW'));
html=render({state:'BLOCKED',contracted:null,billedTotal:null,difference:null,message:'Aguarda contrato validado',sources:[]});assert.ok(html.includes('Conciliação pendente'));assert.ok(!html.includes('Soma das parcelas faturadas'));
assert.ok(renderToStaticMarkup(React.createElement(C,{evidence:base})).includes('Parcelas faturadas'));console.log('Demand reconciliation UI states passed');
