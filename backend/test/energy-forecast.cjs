const assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (m,p) => m._compile(ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,p);
const {calculateConsumptionForecast:forecast} = require('../src/modules/energy-forecast/consumption-forecast.ts');
const {calculateCarbonComparison:carbon} = require('../src/modules/energy-forecast/carbon-comparison.ts');
// Synthetic fixtures only in tests. No real invoice data or documents.
const scope = {organizationId:'test-org',customerId:'test-customer',unitId:'test-unit'};
const evidence = {...scope,id:'test-source',revision:1,hash:'a'.repeat(64),validatedBy:'test-reviewer',validatedAt:'2026-09-01T00:00:00Z'};
const fixture = (n=24) => ({...scope,asOfMonth:'2026-08',expansions:[],observations:Array.from({length:n},(_,i)=>{
  const index=2026*12+7-n+1+i, year=Math.floor(index/12), m=index%12, days=new Date(Date.UTC(year,m+1,0)).getUTCDate();
  return {month:`${year}-${String(m+1).padStart(2,'0')}`,consumptionKwh:String(100*days),billedDays:days,evidence:{...evidence,id:'test-invoice-'+i}};
})});
let count=0;const check=(v,e)=>{assert.deepEqual(v,e);count++};const rejects=(fn,re)=>{assert.throws(fn,re);count++};
const input=fixture(),original=JSON.stringify(input),result=forecast(input);
check(result.status,'PRELIMINARY');check(result.method,'MONTHLY_MEAN_DAILY');check(result.future.map(r=>r.month),['2026-09','2026-10','2026-11','2026-12']);check(result.future[0].predictedKwh,'3000.000000');check(result.estimatedYearKwh,'36500.000000');check(JSON.stringify(input),original);check(result.weatherApplied,false);check(result.uncertainty,null);
for(const n of [11,37])rejects(()=>forecast(fixture(n)),/HISTORY_12_TO_36_REQUIRED/);
check(forecast(fixture(12)).scores.length,0);check(forecast(fixture(36)).scores.length,3);
for(const patch of [{billedDays:0},{consumptionKwh:'NaN'},{consumptionKwh:'999999999999'}]){const f=fixture();Object.assign(f.observations[0],patch);rejects(()=>forecast(f),/INVALID|NUMERIC_RANGE/)}
for(const patch of [{organizationId:'other'},{unitId:'other'},{customerId:'other'},{validatedBy:''},{revision:0},{hash:''}]){const f=fixture();Object.assign(f.observations[0].evidence,patch);rejects(()=>forecast(f),/SOURCE_/)}
const duplicate=fixture();duplicate.observations[0].month=duplicate.observations[1].month;rejects(()=>forecast(duplicate),/HISTORY_GAP_DUPLICATE_OR_FUTURE/);
const expansion=fixture();expansion.expansions=[{startMonth:'2026-10',endMonth:'2026-12',monthlyKwh:'250',evidence:{...scope,id:'expansion',revision:1,hash:'b'.repeat(64),recordedBy:'test-author',recordedAt:'2026-09-01T00:00:00Z',justification:'Premissa documental para revisão do gestor.'}}];check(forecast(expansion).future.map(r=>r.expansionKwh),['0.000000','250.000000','250.000000','250.000000']);
expansion.expansions[0].startMonth='2026-08';rejects(()=>forecast(expansion),/EXPANSION_ALREADY/);
const trend=fixture(36);trend.observations.forEach((r,i)=>r.consumptionKwh=String((100+i*3)*r.billedDays));check(forecast(trend).method,'LINEAR_DAILY');
const seasonal=fixture(36);seasonal.observations.forEach(r=>r.consumptionKwh=String((100+Number(r.month.slice(5))*50)*r.billedDays));check(forecast(seasonal).method,'MONTHLY_MEAN_DAILY');
const factor={valueTonnesCo2PerMwh:'0.05',source:'test-factor',revision:'1',month:'2026-08',gas:'CO2'};
const c={...scope,month:'2026-08',consumptionKwh:'10000',coveredKwh:'8000',evidence,coverageEvidence:evidence,reference:factor,contractual:{...factor,valueTonnesCo2PerMwh:'0.01'}};
check(carbon(c).differenceTonnesCo2,'0.320000');check(carbon(c).uncoveredKwh,'2000.000000');check(carbon({...c,contractual:null}).differenceTonnesCo2,null);check(carbon({...c,contractual:{...factor,valueTonnesCo2PerMwh:'0.1'}}).differenceTonnesCo2,'-0.400000');
rejects(()=>carbon({...c,coveredKwh:'10001'}),/COVERAGE_EXCEEDS/);rejects(()=>carbon({...c,reference:{...factor,month:'2026-07'}}),/FACTOR_EVIDENCE/);rejects(()=>carbon({...c,coverageEvidence:{...evidence,organizationId:'other'}}),/SOURCE_SCOPE/);
check(carbon({...c,coveredKwh:'0'}).differenceTonnesCo2,'0.000000');
console.log(`${count} preliminary forecast and carbon checks passed`);
