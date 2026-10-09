const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,p)=>m._compile(ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,p);
require.extensions['.css']=m=>m.exports={};
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),Diagnostics=require('../app/backoffice/reports/ClimateDiagnostics.tsx').default;
const summary={version:'climate-cycle/2.0',applied:false,reason:'ganho insuficiente',sensitivity:'LOW',readingAlignment:'CALENDAR_APPROXIMATION',climateMaeKwh:'200',baselineMaeKwh:'100',improvementPercent:-100,winningOrigins:2,originCount:12,predictions:57,byHorizon:[{horizon:1,climateMaeKwh:'200',baselineMaeKwh:'100',predictions:12}]};
const render=props=>renderToStaticMarkup(React.createElement(Diagnostics,props));let checks=0;const check=v=>{assert.ok(v);checks++;};
const html=render({summary}).replace(/<[^>]*>/g,'');
for(const s of ['Referência sem clima preservada','-100%','ganho insuficiente','Baixa influência','2/12','meses civis','não aplica clima','não um teste formal','não são amostras independentes','Não é previsão','200 kWh','100 kWh']){assert.ok(html.includes(s),s);checks++;}
check(!html.includes('Ajuste climático aplicado'));
check(render({summary:{...summary,applied:true,readingAlignment:'DOCUMENTED'}}).includes('Ajuste climático aplicado'));
check(render({assessment:{version:'climate-scenario/1.0'}})==='');
check(render({summary:{version:'climate-cycle/2.0',applied:false,reason:'histórico insuficiente'}}).includes('histórico insuficiente'));
check(!render({summary:{version:'climate-cycle/2.0',applied:false,reason:'histórico insuficiente'}}).includes('NaN'));
check(render({summary:{...summary,improvementPercent:null}}).includes('Indisponível'));
console.log(`${checks} annual climate presentation checks passed`);
