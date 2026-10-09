const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(m,p)=>m._compile(ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,p);
const {calculateConsumptionForecast}=require('../src/modules/energy-forecast/consumption-forecast.ts');
const {applyClimateForecast}=require('../src/modules/energy-forecast/climate-forecast.ts');
// Synthetic temperatures and consumption are test fixtures only, never production sources.
const scope={organizationId:'test-org',customerId:'test-customer',unitId:'test-unit'};
const evidence={...scope,id:'test-source',revision:1,hash:'a'.repeat(64),validatedBy:'test-reviewer',validatedAt:'2026-09-01T00:00:00Z'};
function fixture(n=36,lastMonth=8){
 const temperatures=[21,29,19,25,16,20,14,27,24,18,28,22];
 const observations=Array.from({length:n},(_,i)=>{const index=2026*12+lastMonth-1-n+1+i,year=Math.floor(index/12),m=index%12,days=new Date(Date.UTC(year,m+1,0)).getUTCDate(),phase=m*2*Math.PI/12;return {month:`${year}-${String(m+1).padStart(2,'0')}`,consumptionKwh:((100+i*0.8+10*Math.sin(phase)+3*temperatures[m])*days).toFixed(6),billedDays:days,evidence};});
 const input={...scope,asOfMonth:`2026-${String(lastMonth).padStart(2,'0')}`,observations,expansions:[]};
 const weather={provider:'NASA_POWER',parameter:'T2M',unit:'°C',timeStandard:'UTC',sourceHash:'b'.repeat(64),from:observations[0].month+'-01',to:observations.at(-1).month+'-'+String(observations.at(-1).billedDays).padStart(2,'0'),monthly:observations.map(r=>({month:r.month,temperatureC:temperatures[Number(r.month.slice(5))-1],validDays:r.billedDays,expectedDays:r.billedDays}))};
 return {input,weather};
}
let checks=0;const check=(a,b)=>{assert.deepEqual(a,b);checks++;};
const calculate=f=>applyClimateForecast(f.input,calculateConsumptionForecast(f.input),f.weather);
const f=fixture(),original=JSON.stringify(f),r=calculate(f);
check(r.weatherApplied,true);check(r.method,'CLIMATE_TREND_SEASONAL_DAILY');check(r.formulaVersion,'consumption-forecast/1.3');check(r.status,'PRELIMINARY');check(r.climateAssessment.comparison.predictions,21);
check(r.climateAssessment.scenario,'SAME_MONTH_PREVIOUS_YEAR');check(r.climateAssessment.scenarios.map(s=>s.sourceMonth),['2025-09','2025-10','2025-11','2025-12']);check(JSON.stringify(f),original);
check(r.uncertainty,null);check(r.demandApplied,false);check(r.future.length,4);check(Number(r.climateAssessment.comparison.climateMaeKwh)<0.001,true);
for(const n of [12,18,24,29]){const short=calculate(fixture(n));check(short.weatherApplied,false);check(short.climateAssessment.reason.includes('30 a 36'),true);}
for(const patch of [{provider:'OTHER'},{unit:'F'},{sourceHash:'bad'},{timeStandard:'LST'},{from:'2020-01-01'},{to:'2026-08-30'}]){const x=fixture();Object.assign(x.weather,patch);check(calculate(x).weatherApplied,false);}
for(const patch of [{temperatureC:null},{temperatureC:NaN},{temperatureC:66},{validDays:0},{expectedDays:0}]){const x=fixture();Object.assign(x.weather.monthly[0],patch);check(calculate(x).weatherApplied,false);}
const duplicate=fixture();duplicate.weather.monthly.push(duplicate.weather.monthly[0]);check(calculate(duplicate).weatherApplied,false);
const billing=fixture();billing.input.observations[0].billedDays--;check(calculate(billing).climateAssessment.reason.includes('dias faturados'),true);
const constant=fixture();constant.weather.monthly.forEach(row=>row.temperatureC=22);check(calculate(constant).weatherApplied,false);
const collinear=fixture();collinear.weather.monthly.forEach(row=>row.temperatureC=22+Math.sin((Number(row.month.slice(5))-1)*Math.PI/6));check(calculate(collinear).weatherApplied,false);
const noGain=fixture();noGain.input.observations.forEach((row,i)=>row.consumptionKwh=((100+i)*row.billedDays).toFixed(6));check(calculate(noGain).weatherApplied,false);
const expanded=fixture();expanded.input.expansions=[{startMonth:'2026-10',endMonth:'2026-12',monthlyKwh:'250',evidence:{...scope,id:'test-expansion',revision:1,hash:'c'.repeat(64),recordedBy:'test-actor',recordedAt:'2026-09-01T00:00:00Z',justification:'Premissa documentada somente para teste.'}}];const expandedRun=calculate(expanded);check(expandedRun.weatherApplied,true);check(Number(expandedRun.future[1].predictedKwh)-Number(r.future[1].predictedKwh),250);
// Future observed temperature must not leak into a fold: targets use only prior-year scenario.
const shock=fixture();shock.weather.monthly.slice(-6).forEach(row=>row.temperatureC+=25);const shocked=calculate(shock);check(shocked.climateAssessment.comparison.origins[0],r.climateAssessment.comparison.origins[0]);
check(r.qualifications.some(q=>q.includes('não é previsão meteorológica')),true);
check(calculate(fixture(36,5)).climateAssessment.reason.includes('horizonte'),true);
const missing=fixture();missing.weather.monthly.pop();check(calculate(missing).weatherApplied,false);
assert.throws(()=>applyClimateForecast({...f.input,organizationId:'foreign'},calculateConsumptionForecast(f.input),f.weather),/CLIMATE_SCOPE_INVALID/);checks++;
console.log(`${checks} climate forecast checks passed`);
