const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(m,p)=>m._compile(ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,p);
const {calculateConsumptionForecast}=require('../src/modules/energy-forecast/consumption-forecast.ts');
const {applyClimateCycle,cycleWeatherRange}=require('../src/modules/energy-forecast/climate-cycle.ts');
const {normalizeNasaTemperature}=require('../src/modules/energy-forecast/nasa-power.ts');
const {climateCycleSummary}=require('../src/modules/energy-forecast/climate-summary.ts');
// Synthetic fixtures only: no fictional production sources.
function fixture(){
 const scope={organizationId:'test-org',customerId:'test-client',unitId:'test-unit'},evidence={...scope,id:'source',revision:1,hash:'a'.repeat(64),validatedBy:'reviewer',validatedAt:'2026-09-01T00:00:00Z'};
 const temps=[21,29,19,25,16,20,14,27,24,18,28,22],observations=[],readingPeriods=[],T2M={};
 for(let i=0;i<36;i++){
  const index=2023*12+8+i,year=Math.floor(index/12),m=index%12,month=`${year}-${String(m+1).padStart(2,'0')}`,billedDays=new Date(Date.UTC(year,m+1,0)).getUTCDate();
  observations.push({month,consumptionKwh:((100+i*.8+10*Math.sin(m*Math.PI/6)+3*temps[m])*billedDays).toFixed(6),billedDays,evidence});
  readingPeriods.push({month,previousReading:new Date(Date.UTC(year,m,0)).toISOString().slice(0,10),currentReading:month+'-'+billedDays,evidenceId:evidence.id,page:3});
  for(let d=1;d<=billedDays;d++)T2M[month.replace('-','')+String(d).padStart(2,'0')]=temps[m];
 }
 const input={...scope,asOfMonth:'2026-08',observations,expansions:[]},range=cycleWeatherRange(input,readingPeriods);
 const weather=normalizeNasaTemperature(JSON.stringify({header:{time_standard:'UTC',fill_value:-999},parameters:{T2M:{units:'C'}},properties:{parameter:{T2M}}}),range.from,range.to);
 return {input,weather,options:{sensitivity:'LOW',readingPeriods}};
}
let checks=0;const check=(a,b)=>{assert.deepEqual(a,b);checks++;};
const run=f=>applyClimateCycle(f.input,calculateConsumptionForecast(f.input),f.weather,f.options);
const f=fixture(),before=JSON.stringify(f),r=run(f),c=r.climateAssessment.comparison;
check(r.weatherApplied,true);check(r.formulaVersion,'consumption-forecast/1.4');check(r.status,'PRELIMINARY');check(r.uncertainty,null);check(r.demandApplied,false);check(JSON.stringify(f),before);
check(c.originCount,12);check(c.predictions,57);check(c.byHorizon.map(h=>h.predictions),[12,11,10,9,8,7]);check(new Set(c.testMonths.map(m=>m.slice(5))).size,12);check(c.winningOrigins,12);check(c.selection,'NESTED_TRAINING_ONLY');check(c.statisticalSignificance,false);check(c.minimumImprovementPercent,10);check(c.minimumWinningOrigins,8);check(r.climateAssessment.context.readingAlignment,'DOCUMENTED');check(r.climateAssessment.context.degreeDaysStatus,'NOT_APPLICABLE_LOW_SENSITIVITY');
const approximate=fixture();delete approximate.options.readingPeriods;const a=run(approximate);check(a.weatherApplied,false);check(a.climateAssessment.reason.includes('datas de leitura documentadas'),true);check(a.climateAssessment.context.readingAlignment,'CALENDAR_APPROXIMATION');
check(a.future,calculateConsumptionForecast(approximate.input).future);
const weak=fixture();weak.input.observations.forEach((row,i)=>row.consumptionKwh=((100+i)*row.billedDays).toFixed(6));check(run(weak).weatherApplied,false);
const missing=fixture();missing.weather.daily[0].temperatureC=null;check(run(missing).weatherApplied,false);
const duplicate=fixture();duplicate.weather.daily.push(duplicate.weather.daily[0]);check(run(duplicate).weatherApplied,false);
const old=fixture();delete old.weather.daily;check(run(old).weatherApplied,false);
for(const patch of [{unit:'F'},{provider:'OTHER'},{timeStandard:'LST'},{sourceHash:'bad'},{from:'2023-01-01'}]){const x=fixture();Object.assign(x.weather,patch);check(run(x).weatherApplied,false);}
const short=fixture();short.input.observations.shift();short.options.readingPeriods.shift();check(run(short).weatherApplied,false);
const long=fixture();long.input.asOfMonth='2026-05';long.input.observations=long.input.observations.map((r,i)=>({...r,month:`${Math.floor((2023*12+5+i)/12)}-${String((2023*12+5+i)%12+1).padStart(2,'0')}`}));check(run(long).climateAssessment.reason.includes('horizonte'),true);
for(const mutate of [x=>x.options.readingPeriods.pop(),x=>x.options.readingPeriods[0].evidenceId='other',x=>x.options.readingPeriods[0].currentReading='2023-09-31',x=>x.options.readingPeriods[0].page=0,x=>x.options.readingPeriods[0].previousReading='2023-08-30']){const x=fixture();mutate(x);assert.throws(()=>run(x),/READING_/);checks++;}
const scope=fixture();scope.input.organizationId='foreign';assert.throws(()=>applyClimateCycle(scope.input,calculateConsumptionForecast(f.input),f.weather,f.options),/CLIMATE_SCOPE_INVALID/);checks++;
// Weather from an outer target can affect later origins, but never that origin's predictions/scenario.
const shock=fixture();shock.weather.daily.filter(d=>d.date>='2025-09-01').forEach(d=>d.temperatureC+=10);check(run(shock).climateAssessment.comparison.origins[0],c.origins[0]);
const expansion=fixture();expansion.input.expansions=[{startMonth:'2026-09',endMonth:'2026-12',monthlyKwh:'250',evidence:{...f.input,id:'expansion',revision:1,hash:'c'.repeat(64),recordedBy:'test',recordedAt:'2026-09-01T00:00:00Z',justification:'Premissa documentada apenas para teste.'}}];const e=run(expansion);check(Number(e.future[0].predictedKwh)-Number(r.future[0].predictedKwh),250);
const safe=climateCycleSummary({...r.climateAssessment,coordinates:'secret',sources:'secret',premiseNote:'private'});check(Object.keys(safe).includes('coefficients'),false);check(JSON.stringify(safe).includes('secret'),false);check(JSON.stringify(safe).includes('private'),false);check(safe.climateMaeKwh,c.climateMaeKwh);check(climateCycleSummary({version:'climate-scenario/1.0'}),undefined);
check(f.weather.daily.some(d=>d.date==='2024-02-29'),true);
check(r.climateAssessment.scenarios.every(s=>s.sourceMonths.every(m=>m<=f.input.asOfMonth)),true);
console.log(`${checks} annual climate checks passed`);
