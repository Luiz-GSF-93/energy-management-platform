const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),C=require('../app/backoffice/documents/OcrTaxReconciliation.tsx').default;
const base={key:'icms',label:'ICMS',extracted:'1.00',declared:'1.00',difference:'0.00',count:1,expected:2,partial:true,sources:['table.row.icms'],summary:{source:'table.summary',value:{text:'1,00',confidence:null,pages:[1]}}};
const e={canImport:false,message:'Não aprova a apuração',supplierReferenceCount:2,checks:[{...base,state:'MATCH_EXTRACTED'},{...base,key:'pis',label:'PIS',state:'DIFFERENCE_EXTRACTED'},{...base,key:'cofins',label:'Cofins',state:'AMBIGUOUS',declared:null,summary:null}]};
const html=renderToStaticMarkup(React.createElement(C,{evidence:e,onOpenOriginal:()=>{}}));
for(const t of ['Valores lidos conferem','Diferença nos valores lidos','Resumo com origem ambígua','campos pendentes','não foram tratados como zero','nota fiscal do fornecedor','Conferir resumo de ICMS no PDF','table.summary'])assert.ok(html.includes(t),t);
console.log('Printed tax summary UI states and supplier separation passed');
