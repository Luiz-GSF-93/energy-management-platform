const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
require.extensions['.tsx']=(m,p)=>m._compile(ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,p);
require.extensions['.css']=m=>{m.exports=new Proxy({},{get:(_,key)=>String(key)});};
const original=Module._load;
Module._load=function(name,...args){if(name==='@/app/components/ui')return {Card:({title,children})=>React.createElement('section',null,React.createElement('h2',null,title),children)};return original.call(this,name,...args);};
const ReportView=require('../app/backoffice/reports/ReportPresentation.tsx').default;
// Synthetic fixture confined to this test. Never loaded by the application.
const totals={acr:'1000.00',aclAfterFees:'900.00',savingsAfterFees:'100.00',savingsPercent:'10.00'};
const body={totals,months:[{month:'2026-01',totals,cumulative:'100.00'},{month:'2026-02',totals:null,cumulative:null}],invoices:[{month:'2026-01',consumptionKwh:'500.00',reservationCount:1,findings:[{code:'SOURCE_REVIEW',message:'Conferir a fonte publicada.'}]},{month:'2026-02',consumptionKwh:null,reservationCount:0,findings:[]}],composition:[{key:'distributor',label:'Distribuidora',amount:'900.00',percent:'100.00',offset:'0'}]};
const before=JSON.stringify(body),html=view=>renderToStaticMarkup(React.createElement(ReportView,{view,body}));
const operational=html('OPERATIONAL'),executive=html('EXECUTIVE'),financial=html('FINANCIAL');
assert.match(operational,/Consumo mensal validado/);assert.match(operational,/Sem leitura/);assert.match(operational,/não representa uma consulta de consumo à API CCEE/);assert.doesNotMatch(operational,/Economia acumulada no período publicado/);
assert.match(executive,/ROI da migração/);assert.match(executive,/Indisponível/);assert.match(executive,/não é uma média aritmética/);assert.doesNotMatch(executive,/Composição do custo ACL publicado/);
assert.match(financial,/conic-gradient/);assert.match(financial,/Vencimento OCR/);assert.match(financial,/não comprovam pagamento/);assert.match(financial,/Sem publicação/);
for(const result of [operational,executive,financial]){assert.match(result,/SOURCE_REVIEW/);assert.match(result,/não executa nova interpretação de IA/);}
assert.equal(JSON.stringify(body),before);
const absent=renderToStaticMarkup(React.createElement(ReportView,{view:'FINANCIAL',body:{...body,composition:null}}));assert.match(absent,/Não foram estimadas parcelas/);assert.doesNotMatch(absent,/conic-gradient/);
console.log('Report presentation: 21 assertions passed.');
