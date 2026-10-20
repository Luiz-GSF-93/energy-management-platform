const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.tsx']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,f);
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),C=require('../app/backoffice/contracts/SourcePreparationEvidence.tsx').default;
assert.equal(renderToStaticMarkup(React.createElement(C,{})),'');
const markup=renderToStaticMarkup(React.createElement(C,{data:{version:3,documents:[{documentId:'doc',sourceHash:'a'.repeat(64),contractId:'contract',annex:{state:'PROPOSED',price:'118.00',index:'IPCA/IBGE',volumeTerms:{hours:720,contractedMwh:'72',minPercent:'50',maxTolerancePercent:'40'},pending:['<script>untrusted PDF</script>']},conflicts:['Volume cadastrado diverge.']}]}}));
assert(markup.includes('720'));assert(markup.includes('118.00'));assert(markup.includes('preço final depende'));assert(markup.includes('40%'));assert(markup.includes('Volume cadastrado diverge'));assert(!markup.includes('<script>'));assert(markup.includes('&lt;script&gt;'));
console.log('PASS contract evidence UI: source-preserving proposals, base/final distinction, volume normalization and escaped untrusted text.');
