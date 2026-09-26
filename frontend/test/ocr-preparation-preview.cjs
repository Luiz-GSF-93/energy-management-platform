const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file);
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),Component=require('../app/backoffice/documents/OcrPreparationPreview.tsx').default;
const render=values=>renderToStaticMarkup(React.createElement(Component,{evidence:{canImport:false,message:'Prévia sem gravação',values,pending:[]}}));
const field={key:'peak',label:'Consumo ponta',unit:'kWh',decimal:'12.3456',state:'EXTRACTED_REVIEW',sources:['table1'],reasons:['REVIEW_AND_IDENTITY_REQUIRED']};
const html=render([field]);for(const s of ['12,3456 kWh','Extraído — aguarda revisão','Importação automática: não liberada','Nenhuma medição validada foi substituída'])assert.ok(html.includes(s));
const conflict=render([{...field,decimal:null,state:'CONFLICT',reasons:['ENERGY_TUSD_QUANTITY_CONFLICT']}]);assert.ok(conflict.includes('Divergência'));assert.ok(conflict.includes('A conferir'));assert.ok(!conflict.includes('12,3456'));assert.ok(!render([{...field,label:'<img src=x>'}]).includes('<img'));console.log('Preparation preview: 8 checks passed');
