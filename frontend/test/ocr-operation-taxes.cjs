const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
const {operationTaxSummary:sum}=require('../app/backoffice/documents/operation-tax-summary.ts');
const f=(v)=>({text:v.replace('.',','),decimal:v,confidence:null,pages:[1],issues:['MISSING_CONFIDENCE']});
const row=(source,role='CHARGE',v='0.10')=>({source,role,component:'TUSD_ENERGY',period:'PEAK',issues:[],fields:{description:{text:'TUSD ponta <img>',confidence:null,pages:[1],issues:[]},amount:f('10.00'),icmsAmount:f(v),pisAmount:f(v),cofinsAmount:f(v)}});
assert.equal(sum([row('a'),row('b','CHARGE','0.20')])[0].totals[0].value,'0,30');
assert.equal(sum([row('a'),row('s','TOTAL','99'),row('i','INFORMATION','99')])[0].totals[0].value,'0,10');
assert.equal(sum([row('a'),row('b','CREDIT','-0.03')])[1].totals[0].value,'-0,03');
const missing=row('m');delete missing.fields.icmsAmount;assert.deepEqual(sum([row('a'),missing])[0].totals[0],{key:'icmsAmount',label:'ICMS',value:'0,10',count:1,expected:2,partial:true});
assert.equal(sum([row('a','CHARGE','0')])[0].totals[0].value,'0,00');assert.equal(sum([missing])[0].totals[0].value,null);
assert.equal(sum([row('a'),row('a')])[0].totals[0].count,0);
assert.equal(sum([row('a','CHARGE','1.001')])[0].totals[0].value,null);
const bad=row('a');bad.fields.icmsAmount.issues=['UNVERIFIED_SOURCE'];assert.equal(sum([bad])[0].totals[0].value,null);
const merged=row('a');merged.issues=['MERGED_OR_DUPLICATE_CELL'];assert.equal(sum([merged])[0].totals[0].value,null);
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');const C=require('../app/backoffice/documents/OcrOperationTaxes.tsx').default;
const cde=row('cde','CHARGE','10.29');cde.component='CDE_WATER_SCARCITY';cde.fields.description.text='CDE Escassez Hídrica Ponta';
const html=renderToStaticMarkup(React.createElement(C,{operations:[row('a'),cde,missing,row('credit','CREDIT','-1')],onOpenOriginal:()=>{}}));
for(const t of ['ICMS','PIS','Cofins','CDE Escassez Hídrica Ponta','Soma parcial','Créditos e descontos','Conferir ICMS no PDF','não são acrescentados novamente'])assert.ok(html.includes(t),t);assert.ok(!html.includes('<img>'));console.log('Tax cards: exact sums, missing values, credits, duplicate sources and display passed');

const acl=row('acl');acl.component='ACL_DISTRIBUTOR_INFORMATION';acl.fields={description:{text:'Energia ACL Ponta',confidence:null,pages:[1],issues:[]}};
const supplier=sum([row('distributor'),acl]);assert.equal(supplier[0].referenceCount,1);assert.equal(supplier[0].totals[0].expected,1);assert.equal(supplier[0].totals[0].partial,false);
const supplierHtml=renderToStaticMarkup(React.createElement(C,{operations:[acl]}));assert.ok(supplierHtml.includes('conferir NF do fornecedor'));assert.ok(!supplierHtml.includes('Não identificado — não equivale a zero'));
const explicit=row('acl-tax');explicit.component='ACL_DISTRIBUTOR_INFORMATION';assert.equal(sum([explicit])[0].referenceCount,0);
console.log('Supplier ACL tax ownership checks passed');

const combined=row('elektro');delete combined.fields.pisAmount;delete combined.fields.cofinsAmount;combined.fields.pisCofinsAmount=f('3.41');const ct=sum([combined])[0];assert.deepEqual(ct.totals.map(t=>t.key),['icmsAmount','pisCofinsAmount']);assert.equal(ct.totals[1].value,'3,41');const combinedHtml=renderToStaticMarkup(React.createElement(C,{operations:[combined]}));assert.ok(combinedHtml.includes('PIS/Cofins conjunto'));assert.ok(combinedHtml.includes('sem estimar valores individuais'));assert.ok(!combinedHtml.includes('<strong>PIS</strong>'));console.log('Elektro combined tax presentation passed');
