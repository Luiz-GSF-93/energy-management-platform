const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file);
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),Component=require('../app/backoffice/documents/OcrTranscription.tsx').default;
const render=e=>renderToStaticMarkup(React.createElement(Component,{evidence:e}));
assert.ok(render().includes('indisponível'));assert.ok(render({state:'UNAVAILABLE',confidence:null}).includes('indisponível'));
const html=render({state:'VERIFIED_WORDS',confidence:0.982,wordCount:2});for(const s of ['98,2%','menor confiança de 2 palavra(s)','Não aprova o campo para cálculo'])assert.ok(html.includes(s));assert.ok(render({state:'VERIFIED_WORDS',confidence:0,wordCount:1}).includes('0%'));console.log('Transcription UI: 6 checks passed');
